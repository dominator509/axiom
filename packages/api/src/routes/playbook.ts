// ─── Playbook adherence score (F-57, L3.0) — real calculation ───
// GET /models/:id/playbook-score — Fanvue Creator Course Adherence Score,
// computed from the published post cadence + history, persisted to
// playbook_score for trend tracking.

import { Hono } from 'hono';
import { sql, eq, and, desc } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, writeAudit, apiError, statusTitle } from './helpers.js';
import { calculateCourseAdherence } from '@axiom/llm-gateway';

const router = new Hono<AppBindings>();

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
        sql`${schema.postTarget.scheduledFor} >= now() - interval '30 days'`,
      ),
    );

  const published = targets.filter((t: { state?: string | null }) => t.state === 'published');
  const scheduleCount30d = targets.length;
  const postCount30d = published.length;
  const cadencePerDay = scheduleCount30d > 0 ? scheduleCount30d / 30 : 0;

  // Cadence regularity: distinct days with any scheduled post / 30
  const activeDays = new Set(
    published
      .map((t: { scheduledFor?: Date | string | null }) => t.scheduledFor)
      .filter((d: Date | string | null | undefined): d is Date | string => d != null)
      .map((d: Date | string) => new Date(d).toISOString().slice(0, 10)),
  ).size;
  const personaConsistency = Math.min(activeDays / 30, 1);

  // ToS pass share — inspect each published post's bundle ToS verdict
  const publishedBundles = await tx
    .select({ tosReport: schema.contentBundle.tosReport })
    .from(schema.contentBundle)
    .innerJoin(schema.postTarget, eq(schema.postTarget.bundleId, schema.contentBundle.id))
    .where(
      and(
        eq(schema.contentBundle.modelId, modelId),
        eq(schema.contentBundle.orgId, orgId),
        eq(schema.postTarget.state, 'published'),
      ),
    );
  const reports = publishedBundles
    .map((b: { tosReport?: unknown }) => (b.tosReport ?? {}) as { verdict?: string })
    .filter((r: { verdict?: string }) => r.verdict != null);
  const platformRuleCompliance =
    reports.length > 0
      ? reports.filter((r: { verdict?: string }) => r.verdict === 'pass').length / reports.length
      : 0.5;

  // Engagement vs 5% baseline (neutral when no metrics yet)
  const metrics = await tx
    .select({
      rate: sql<number>`coalesce(avg(${schema.postMetric.engagementRate}),0)`,
    })
    .from(schema.postMetric)
    .innerJoin(schema.postTarget, eq(schema.postTarget.id, schema.postMetric.postTargetId))
    .innerJoin(schema.contentBundle, eq(schema.contentBundle.id, schema.postTarget.bundleId))
    .where(and(eq(schema.contentBundle.modelId, modelId), eq(schema.contentBundle.orgId, orgId)));
  const avgRate = metrics[0]?.rate ?? 0;
  const exemplarSimilarity = Math.min(avgRate / 0.05, 1);

  // Scheduled → published conversion
  const taskAlignment =
    scheduleCount30d > 0 ? published.length / scheduleCount30d : 0;

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
  return c.json({ data: saved }, 201);
});

export { router as playbookRouter };
