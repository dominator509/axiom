// ─── Viral insights (F-85, L3.0) — real viral_exemplar reads ───
// GET /models/:id/viral — what's-working insights from labeled exemplars.

import { Hono } from 'hono';
import { sql, eq, and, desc, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { schema } from '@axiom/db';
import { enqueueJob, enqueueWeeklyViralInsight } from '@axiom/worker';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, apiError, statusTitle, writeAudit } from './helpers.js';
import { parseCursor, cursorLt, nextCursor } from '../contract.js';
import { modelAccessCondition } from '../model-access.js';
import { isoWeekKey } from './digests.js';
import { readBoundedJson, RequestBodyTooLargeError } from '../webhook-body.js';

export const LEARNING_ARM_RICH_PATTERN = '^v2:(short|medium|long):(question|statement):hook=(question|bold-claim|story|stat|controversy|teaser|unknown):format=(reel|carousel|single|story|longform|unknown)(:time=(morning|afternoon|evening|night))?$';

const router = new Hono<AppBindings>();

const insightEnqueueRoles = new Set(['owner', 'manager', 'operator', 'content_creator']);
const insightScheduleRoles = new Set(['owner', 'manager']);
const insightScheduleSchema = z.object({ enabled: z.boolean() }).strict();
const patternSharingSchema = z.object({ enabled: z.boolean() }).strict();

router.get('/models/:modelId/viral/pattern-sharing', async c => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const modelId = c.req.param('modelId');
  const rows = await withOrgContext(orgId, tx => tx.select({
    enabled: schema.modelProfile.viralPatternSharingEnabled,
  }).from(schema.modelProfile).where(and(
    eq(schema.modelProfile.orgId, orgId),
    eq(schema.modelProfile.id, modelId),
    modelAccessCondition(c.get('role'), orgId, c.get('userId'), schema.modelProfile.id),
  )).limit(1));
  if (!rows[0]) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: { enabled: rows[0].enabled === true } });
});

router.patch('/models/:modelId/viral/pattern-sharing', async c => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const userId = c.get('userId');
  const role = c.get('role');
  if (!userId) return apiError(c, 401, statusTitle(401), 'authentication required');
  if (!insightScheduleRoles.has(role ?? ''))
    return apiError(c, 403, statusTitle(403), 'cross-model pattern sharing requires an owner or manager');

  let payload: unknown;
  try {
    payload = await readBoundedJson(c.req.raw, 8 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError)
      return apiError(c, 413, statusTitle(413), 'pattern sharing body too large');
    payload = {};
  }
  const parsed = patternSharingSchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid pattern sharing setting');

  const modelId = c.req.param('modelId');
  const result = await withOrgContext(orgId, async tx => {
    const [current] = await tx.select({ id: schema.modelProfile.id })
      .from(schema.modelProfile).where(and(
        eq(schema.modelProfile.orgId, orgId), eq(schema.modelProfile.id, modelId),
      )).limit(1).for('update');
    if (!current) return null;
    const [saved] = await tx.update(schema.modelProfile).set({
      viralPatternSharingEnabled: parsed.data.enabled,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.modelProfile.orgId, orgId), eq(schema.modelProfile.id, modelId),
    )).returning({ id: schema.modelProfile.id });
    if (!saved) return null;
    await writeAudit(tx, orgId, userId, 'viral.pattern_sharing.update', modelId, { enabled: parsed.data.enabled });
    return { enabled: parsed.data.enabled };
  });
  if (!result) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: result });
});

router.get('/models/:modelId/viral/insight-schedule', async c => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const role = c.get('role');
  const modelId = c.req.param('modelId');
  const rows = await withOrgContext(orgId, tx => tx.select({
    id: schema.modelProfile.id,
    scheduleId: schema.modelProfile.viralInsightScheduleId,
  }).from(schema.modelProfile).where(and(
    eq(schema.modelProfile.orgId, orgId),
    eq(schema.modelProfile.id, modelId),
    modelAccessCondition(role, orgId, c.get('userId'), schema.modelProfile.id),
  )).limit(1));
  if (!rows[0]) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: { enabled: Boolean(rows[0].scheduleId), scheduleId: rows[0].scheduleId ?? null } });
});

router.patch('/models/:modelId/viral/insight-schedule', async c => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const userId = c.get('userId');
  const role = c.get('role');
  if (!userId) return apiError(c, 401, statusTitle(401), 'authentication required');
  if (!insightScheduleRoles.has(role ?? ''))
    return apiError(c, 403, statusTitle(403), 'recurring viral insight scheduling requires an owner or manager');

  let payload: unknown;
  try {
    payload = await readBoundedJson(c.req.raw, 8 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError)
      return apiError(c, 413, statusTitle(413), 'viral insight schedule body too large');
    payload = {};
  }
  const parsed = insightScheduleSchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid viral insight schedule');

  const modelId = c.req.param('modelId');
  const result = await withOrgContext(orgId, async tx => {
    const [current] = await tx.select({
      id: schema.modelProfile.id,
      scheduleId: schema.modelProfile.viralInsightScheduleId,
    }).from(schema.modelProfile).where(and(
      eq(schema.modelProfile.orgId, orgId),
      eq(schema.modelProfile.id, modelId),
    )).limit(1).for('update');
    if (!current) return null;

    const scheduleId = parsed.data.enabled ? current.scheduleId ?? randomUUID() : null;
    const [saved] = await tx.update(schema.modelProfile).set({
      viralInsightScheduleId: scheduleId,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.modelProfile.orgId, orgId),
      eq(schema.modelProfile.id, modelId),
    )).returning({ id: schema.modelProfile.id });
    if (!saved) return null;
    if (scheduleId) await enqueueWeeklyViralInsight(tx, orgId, modelId, scheduleId);
    await writeAudit(tx, orgId, userId, 'viral.insight.schedule.update', modelId, { enabled: Boolean(scheduleId) });
    return { enabled: Boolean(scheduleId), scheduleId };
  });
  if (!result) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: result });
});

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

export async function readExemplarPatterns(tx: any, orgId: string, modelId: string, access?: SQL, sharingEnabled = false) {
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
        OR ${arm} ~ ${LEARNING_ARM_RICH_PATTERN})`,
      sql`${context} ~ '^learn-v[12]:scheduled-utc-(unknown|[0-3])$'`,
      sql`${schema.viralExemplar.perfScore} NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)`))
    .groupBy(schema.viralExemplar.platform, arm, context, mediaFormat, tosVerdict, publishedHourUtc).having(sql`count(*) >= 3`)
    .orderBy(desc(mean), schema.viralExemplar.platform, arm, context).limit(21);
  const projectPattern = (row: (typeof rows)[number], sourceScope: 'model' | 'organization') => ({
    platform: row.platform,
    arm: row.arm,
    context: row.context,
    mediaFormat: row.mediaFormat,
    tosVerdict: row.tosVerdict,
    publishedHourUtc: row.publishedHourUtc,
    sampleSize: row.sampleSize,
    meanScore: row.meanScore,
    sourceScope,
  });
  const ownGroups = rows.slice(0, 20).map((row: (typeof rows)[number]) => projectPattern(row, 'model'));
  let sharedRows: typeof rows = [];
  if (sharingEnabled) {
    sharedRows = await tx.select({ platform: schema.viralExemplar.platform, arm, context, mediaFormat,
      tosVerdict, publishedHourUtc, sampleSize: sql<number>`count(*)::int`, meanScore: mean }).from(schema.viralExemplar)
      .where(and(eq(schema.viralExemplar.orgId, orgId), sql`${schema.viralExemplar.modelId} <> ${modelId}`,
        sql`EXISTS (SELECT 1 FROM model_profile sharing_model
          WHERE sharing_model.org_id=${orgId} AND sharing_model.id=${schema.viralExemplar.modelId}
            AND sharing_model.viral_pattern_sharing_enabled IS TRUE)`,
        publishedExemplarEvidence(),
        sql`(${arm} ~ '^(short|medium|long):(question|statement)$' OR ${arm} ~ ${LEARNING_ARM_RICH_PATTERN})`,
        sql`${context} ~ '^learn-v[12]:scheduled-utc-(unknown|[0-3])$'`,
        sql`${schema.viralExemplar.perfScore} NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)`))
      .groupBy(schema.viralExemplar.platform, arm, context, mediaFormat, tosVerdict, publishedHourUtc)
      .having(sql`count(*) >= 5 AND count(DISTINCT ${schema.viralExemplar.modelId}) >= 2`)
      .orderBy(desc(mean), schema.viralExemplar.platform, arm, context).limit(21);
  }
  const organizationGroups = sharedRows.slice(0, 20).map((row: (typeof rows)[number]) => projectPattern(row, 'organization'));
  const combined = [...ownGroups, ...organizationGroups].sort((left, right) => right.meanScore - left.meanScore);
  return {
    groups: combined.slice(0, 20),
    truncated: rows.length > 20 || sharedRows.length > 20 || combined.length > 20,
    minimumSample: 3 as const,
  };
}

// POST /models/:id/viral/insight — enqueue one model/window insight build.
// The executor remains provider-free and stores only a local Relay card.
router.post('/models/:modelId/viral/insight', async c => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const role = c.get('role');
  if (!insightEnqueueRoles.has(role ?? '')) {
    return apiError(c, 403, statusTitle(403), 'viral insight generation requires an operator or assigned creator role');
  }
  const modelId = c.req.param('modelId');
  const windowKey = isoWeekKey();
  const result = await withOrgContext(orgId, async tx => {
    const model = await tx.select({ id: schema.modelProfile.id })
      .from(schema.modelProfile)
      .where(and(
        eq(schema.modelProfile.orgId, orgId),
        eq(schema.modelProfile.id, modelId),
        modelAccessCondition(role, orgId, c.get('userId'), schema.modelProfile.id),
      ))
      .limit(1);
    if (!model[0]) return { error: 'model not found' as const };
    const job = await enqueueJob(tx, {
      orgId,
      queue: 'viral',
      kind: 'viral.insight',
      payload: { modelId, windowKey },
      dedupeParts: ['viral.insight', modelId, windowKey],
    });
    return { jobId: job?.id ?? null, deduplicated: !job, windowKey };
  });
  if ('error' in result) return apiError(c, 404, statusTitle(404), result.error ?? 'model not found');
  if (!result.jobId) return apiError(c, 409, 'Conflict', 'viral insight for this model window is already queued');
  return c.json({ success: true, jobId: result.jobId, windowKey }, 202);
});

// GET /models/:id/viral — exemplar distribution + top performers
router.get('/models/:modelId/viral', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();
  const { limit, cursor } = parseCursor(c, 20, 100);

  const data = await withOrgContext(orgId, async (tx) => {
    const target = await tx.select({ id: schema.modelProfile.id, sharingEnabled: schema.modelProfile.viralPatternSharingEnabled })
      .from(schema.modelProfile).where(and(
        eq(schema.modelProfile.orgId, orgId), eq(schema.modelProfile.id, modelId),
        modelAccessCondition(c.get('role'), orgId, c.get('userId'), schema.modelProfile.id),
      )).limit(1);
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
      patterns: await readExemplarPatterns(tx, orgId, modelId, access, target[0]?.sharingEnabled === true),
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
