// ─── Viral insights (F-85, L3.0) — real viral_exemplar reads ───
// GET /models/:id/viral — what's-working insights from labeled exemplars.

import { Hono } from 'hono';
import { sql, eq, and, desc, type SQL } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, apiError, statusTitle } from './helpers.js';
import { parseCursor, cursorLt, nextCursor } from '../contract.js';
import { modelAccessCondition } from '../model-access.js';

const router = new Hono<AppBindings>();

/** Retained legacy/manual exemplars are not evidence of published performance. */
export function publishedExemplarEvidence() {
  return sql`${schema.viralExemplar.features}->>'evidence_source' = 'published-provider-snapshot-v2'
    AND EXISTS (SELECT 1 FROM post_target t JOIN content_bundle b ON b.id=t.bundle_id AND b.org_id=t.org_id
      WHERE t.org_id=${schema.viralExemplar.orgId} AND t.bundle_id=${schema.viralExemplar.bundleId}
        AND b.model_id=${schema.viralExemplar.modelId} AND t.platform=${schema.viralExemplar.platform}
        AND t.state='published' AND t.remote_id IS NOT NULL
        AND t.published_at IS NOT NULL AND t.published_at <= now()
        AND EXISTS (SELECT 1 FROM post_metric m WHERE m.post_target_id=t.id
          AND m.source='provider' AND m.remote_id=t.remote_id AND m.platform=t.platform
          AND m.collected_at <= now()))`;
}

export async function readExemplarPatterns(tx: any, orgId: string, modelId: string, access?: SQL) {
  const arm = sql<string>`${schema.viralExemplar.features}->>'learning_arm'`;
  const context = sql<string>`${schema.viralExemplar.features}->>'learning_context'`;
  // These dimensions come from the immutable publication recipe evidence. Do
  // not infer them from the current bundle: editable inputs are not historical
  // evidence and must never change an already-labeled pattern.
  const mediaFormat = sql<string>`COALESCE(NULLIF(${schema.viralExemplar.features}->'media'->>'mimeType', ''), NULLIF(${schema.viralExemplar.features}->'media'->>'kind', ''), 'unknown')`;
  const tosVerdict = sql<string>`COALESCE(NULLIF(${schema.viralExemplar.features}->'tos_report_at_publication'->>'verdict', ''), 'unavailable')`;
  const publishedHourUtc = sql<number | null>`CASE
    WHEN (${schema.viralExemplar.features}->>'published_hour_utc') ~ '^(0|[1-9]|1[0-9]|2[0-3])$'
      THEN ((${schema.viralExemplar.features}->>'published_hour_utc')::int)
    ELSE NULL
  END`;
  const mean = sql<number>`avg(${schema.viralExemplar.perfScore})::float8`;
  const rows = await tx.select({ platform: schema.viralExemplar.platform, arm, context, mediaFormat,
    tosVerdict, publishedHourUtc, sampleSize: sql<number>`count(*)::int`, meanScore: mean }).from(schema.viralExemplar)
    .where(and(eq(schema.viralExemplar.orgId, orgId), eq(schema.viralExemplar.modelId, modelId), access,
      publishedExemplarEvidence(),
      sql`(${arm} ~ '^(short|medium|long):(question|statement)$'
        OR ${arm} ~ '^v2:(short|medium|long):(question|statement):hook=(question|bold-claim|story|stat|controversy|teaser|unknown):format=(reel|carousel|single|story|longform|unknown)$')`,
      sql`${context} ~ '^learn-v[12]:scheduled-utc-(unknown|[0-3])$'`,
      sql`${schema.viralExemplar.perfScore} NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)`))
    .groupBy(schema.viralExemplar.platform, arm, context, mediaFormat, tosVerdict, publishedHourUtc).having(sql`count(*) >= 3`)
    .orderBy(desc(mean), schema.viralExemplar.platform, arm, context).limit(21);
  return { groups: rows.slice(0, 20), truncated: rows.length > 20, minimumSample: 3 as const };
}

// GET /models/:id/viral — exemplar distribution + top performers
router.get('/models/:modelId/viral', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();
  const { limit, cursor } = parseCursor(c, 20, 100);

  const data = await withOrgContext(orgId, async (tx) => {
    const access = modelAccessCondition(c.get('role'), orgId, c.get('userId'), schema.viralExemplar.modelId);
    const byLabel = await tx
      .select({
        label: schema.viralExemplar.label,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.viralExemplar)
      .where(and(eq(schema.viralExemplar.orgId, orgId), eq(schema.viralExemplar.modelId, modelId), access, publishedExemplarEvidence()))
      .groupBy(schema.viralExemplar.label)
      .orderBy(schema.viralExemplar.label);

    const top = await tx
      .select()
      .from(schema.viralExemplar)
      .where(
        and(
          eq(schema.viralExemplar.orgId, orgId),
          eq(schema.viralExemplar.modelId, modelId),
          access,
          publishedExemplarEvidence(),
          ...cursorLt(schema.viralExemplar.perfScore, schema.viralExemplar.id, cursor),
        ),
      )
      .orderBy(desc(schema.viralExemplar.perfScore), desc(schema.viralExemplar.id))
      .limit(limit);

    const byPlatform = await tx
      .select({
        platform: schema.viralExemplar.platform,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.viralExemplar)
      .where(and(eq(schema.viralExemplar.orgId, orgId), eq(schema.viralExemplar.modelId, modelId), access, publishedExemplarEvidence()))
      .groupBy(schema.viralExemplar.platform)
      .orderBy(sql`count(*) DESC`);

    return {
      totalExemplars: byLabel.reduce((acc: number, r: { count: number }) => acc + r.count, 0),
      byLabel,
      byPlatform,
      top,
      patterns: await readExemplarPatterns(tx, orgId, modelId, access),
    };
  });
  const last = data.top[data.top.length - 1];
  return c.json({
    data,
    meta: {
      total: data.top.length,
      limit,
      next_cursor: nextCursor(last?.perfScore, last?.id, limit, data.top.length),
    },
  });
});

export { router as viralRouter };
