// ─── Playbook adherence score (F-57, L3.0) — real calculation ───
// GET /models/:id/playbook-score — Fanvue Creator Course Adherence Score,
// computed from the published post cadence + history, persisted to
// playbook_score for trend tracking.

import { Hono } from 'hono';
import { eq, and, desc, gte } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import {
  withOrgContext,
  modelOrgId,
  requireOrg,
  writeAudit,
  apiError,
  statusTitle,
} from './helpers.js';
import { calculateCourseAdherence } from '@axiom/llm-gateway';

const router = new Hono<AppBindings>();

export const PLAYBOOK_WINDOW_DAYS = 30;
const PLAYBOOK_WINDOW_MS = PLAYBOOK_WINDOW_DAYS * 86_400_000;

export function playbookWindowStart(now = new Date()): Date {
  return new Date(now.getTime() - PLAYBOOK_WINDOW_MS);
}

/**
 * Derive the four Course-Adherence inputs (all 0–1) from real published
 * post data over the last 30 days:
 *  - personaConsistency: cadence regularity (post days / 30)
 *  - platformRuleCompliance: share of published posts whose ToS report
 *    passed for their platform (0 when no report, neutral 0.5)
 *  - exemplarSimilarity: engagement rate normalized against a 5% baseline
 *  - taskAlignment: fraction of scheduled targets that reached 'published'
 */
async function deriveAdherenceInputs(
  tx: any,
  orgId: string,
  modelId: string,
): Promise<{
  input: {
    personaConsistency: number;
    platformRuleCompliance: number;
    exemplarSimilarity: number;
    taskAlignment: number;
  };
  cadencePerDay: number;
  postCount30d: number;
  scheduleCount30d: number;
}> {
  const windowStart = playbookWindowStart();
  const targets = await tx
    .select({
      platform: schema.postTarget.platform,
      scheduledFor: schema.postTarget.scheduledFor,
      state: schema.postTarget.state,
    })
    .from(schema.postTarget)
    .innerJoin(schema.contentBundle, eq(schema.contentBundle.id, schema.postTarget.bundleId))
    .where(
      and(
        eq(schema.contentBundle.modelId, modelId),
        eq(schema.contentBundle.orgId, orgId),
        eq(schema.postTarget.orgId, orgId),
        gte(schema.postTarget.scheduledFor, windowStart),
      ),
    );

  const recentTargets = targets.filter((target: { scheduledFor?: Date | string | null }) => {
    const scheduledFor = target.scheduledFor ? new Date(target.scheduledFor) : null;
    return (
      scheduledFor !== null && !Number.isNaN(scheduledFor.getTime()) && scheduledFor >= windowStart
    );
  });
  const published = recentTargets.filter((t: { state?: string | null }) => t.state === 'published');
  const scheduleCount30d = recentTargets.length;
  const postCount30d = published.length;
  const cadencePerDay = scheduleCount30d > 0 ? scheduleCount30d / PLAYBOOK_WINDOW_DAYS : 0;

  // Cadence regularity: distinct days with any scheduled post / 30
  const activeDays = new Set(
    published
      .map((t: { scheduledFor?: Date | string | null }) => t.scheduledFor)
      .filter((d: Date | string | null | undefined): d is Date | string => d != null)
      .map((d: Date | string) => new Date(d).toISOString().slice(0, 10)),
  ).size;
  const personaConsistency = Math.min(activeDays / PLAYBOOK_WINDOW_DAYS, 1);

  // ToS pass share — inspect each published post's bundle ToS verdict
  const publishedBundles = await tx
    .select({
      tosReport: schema.contentBundle.tosReport,
      scheduledFor: schema.postTarget.scheduledFor,
      state: schema.postTarget.state,
    })
    .from(schema.contentBundle)
    .innerJoin(schema.postTarget, eq(schema.postTarget.bundleId, schema.contentBundle.id))
    .where(
      and(
        eq(schema.contentBundle.modelId, modelId),
        eq(schema.contentBundle.orgId, orgId),
        eq(schema.postTarget.orgId, orgId),
        eq(schema.postTarget.state, 'published'),
        gte(schema.postTarget.scheduledFor, windowStart),
      ),
    );
  const reports = publishedBundles
    .filter((bundle: { scheduledFor?: Date | string | null; state?: string | null }) => {
      const scheduledFor = bundle.scheduledFor ? new Date(bundle.scheduledFor) : null;
      return (
        bundle.state === 'published' &&
        scheduledFor !== null &&
        !Number.isNaN(scheduledFor.getTime()) &&
        scheduledFor >= windowStart
      );
    })
    .map((b: { tosReport?: unknown }) => (b.tosReport ?? {}) as { verdict?: string })
    .filter((r: { verdict?: string }) => r.verdict != null);
  const platformRuleCompliance =
    reports.length > 0
      ? reports.filter((r: { verdict?: string }) => r.verdict === 'pass').length / reports.length
      : 0.5;

  // Engagement vs 5% baseline (neutral when no metrics yet)
  const metricRows = await tx
    .select({
      postTargetId: schema.postMetric.postTargetId,
      collectedAt: schema.postMetric.collectedAt,
      rate: schema.postMetric.engagementRate,
      scheduledFor: schema.postTarget.scheduledFor,
      state: schema.postTarget.state,
    })
    .from(schema.postMetric)
    .innerJoin(schema.postTarget, eq(schema.postTarget.id, schema.postMetric.postTargetId))
    .innerJoin(schema.contentBundle, eq(schema.contentBundle.id, schema.postTarget.bundleId))
    .where(
      and(
        eq(schema.contentBundle.modelId, modelId),
        eq(schema.contentBundle.orgId, orgId),
        eq(schema.postTarget.orgId, orgId),
        eq(schema.postTarget.state, 'published'),
        gte(schema.postTarget.scheduledFor, windowStart),
        gte(schema.postMetric.collectedAt, windowStart),
      ),
    )
    .orderBy(desc(schema.postMetric.collectedAt));
  const recentMetricRows = metricRows.filter(
    (row: {
      scheduledFor?: Date | string | null;
      collectedAt?: Date | string | null;
      state?: string | null;
    }) => {
      const scheduledFor = row.scheduledFor ? new Date(row.scheduledFor) : null;
      const collectedAt = row.collectedAt ? new Date(row.collectedAt) : null;
      return (
        row.state === 'published' &&
        scheduledFor !== null &&
        !Number.isNaN(scheduledFor.getTime()) &&
        scheduledFor >= windowStart &&
        collectedAt !== null &&
        !Number.isNaN(collectedAt.getTime()) &&
        collectedAt >= windowStart
      );
    },
  );
  const seenMetricTargets = new Set<string>();
  const latestMetricRows = recentMetricRows.filter((row: { postTargetId: string }) => {
    if (seenMetricTargets.has(row.postTargetId)) return false;
    seenMetricTargets.add(row.postTargetId);
    return true;
  });
  const avgRate =
    latestMetricRows.length > 0
      ? latestMetricRows.reduce(
          (sum: number, row: { rate: number }) => sum + Number(row.rate ?? 0),
          0,
        ) / latestMetricRows.length
      : 0;
  const exemplarSimilarity = Math.min(avgRate / 0.05, 1);

  // Scheduled → published conversion
  const taskAlignment = scheduleCount30d > 0 ? published.length / scheduleCount30d : 0;

  return {
    input: {
      personaConsistency,
      platformRuleCompliance,
      exemplarSimilarity,
      taskAlignment,
    },
    cadencePerDay,
    postCount30d,
    scheduleCount30d,
  };
}
// GET /models/:id/playbook-score — current score + history
router.get('/models/:modelId/playbook-score', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();

  const data = await withOrgContext(orgId, async (tx) => {
    const derived = await deriveAdherenceInputs(tx, orgId, modelId);
    const score = calculateCourseAdherence(derived.input);
    const history = await tx
      .select()
      .from(schema.playbookScore)
      .where(and(eq(schema.playbookScore.orgId, orgId), eq(schema.playbookScore.modelId, modelId)))
      .orderBy(desc(schema.playbookScore.ts))
      .limit(30);
    return {
      score,
      history,
      cadencePerDay: derived.cadencePerDay,
      postCount30d: derived.postCount30d,
      scheduleCount30d: derived.scheduleCount30d,
    };
  });
  return c.json({ data });
});

// POST /models/:id/playbook-score/record — persist a score snapshot
router.post('/models/:modelId/playbook-score/record', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();
  const userId = c.get('userId') ?? 'system';

  const saved = await withOrgContext(orgId, async (tx) => {
    if ((await modelOrgId(tx, modelId)) !== orgId) return null;
    const derived = await deriveAdherenceInputs(tx, orgId, modelId);
    const score = calculateCourseAdherence(derived.input);
    const [row] = await tx
      .insert(schema.playbookScore)
      .values({
        orgId,
        modelId,
        score: Math.round(score.overall * 100),
        components: {
          overall: score.overall,
          components: score.components,
          weights: score.weights,
          passed: score.passed,
          minimumThreshold: score.minimumThreshold,
          cadencePerDay: derived.cadencePerDay,
          postCount30d: derived.postCount30d,
          scheduleCount30d: derived.scheduleCount30d,
        } as unknown as Record<string, unknown>,
      })
      .returning();
    await writeAudit(tx, orgId, userId, 'playbook.record', modelId, {
      score: score.overall,
    });
    return row;
  });
  if (!saved) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: saved }, 201);
});

export { router as playbookRouter };
