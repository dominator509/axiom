// ─── Viral insights (F-85, L3.0) — real viral_exemplar reads ───
// GET /models/:id/viral — what's-working insights from labeled exemplars.

import { Hono } from 'hono';
import { sql, eq, and, desc } from 'drizzle-orm';
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
