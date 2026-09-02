// ─── Relay viral persistence (M-7) — DB-backed, injected by the API process ───
// The relay package stays persistence-free; this implementation is injected as
// RelayDependencies.viralPersistence (same pattern as relayCommandExecutor).
//
// persist(): maps the relay ingest payload onto the real DB-backed viral path:
//   1. Resolve the post_target by (org_id, platform, remote_id = postId).
//   2. Insert a post_metric row (mirrors worker executors/metrics.ts).
//   3. Enqueue viral.label (the worker executor writes viral_exemplar /
//      viral_recipe / viral_embedding with 768-dim embedding).
//   4. Compute the label synchronously with the same z-score math the
//      executor uses, so the ingest response carries a real label.
// listExemplars(): reads viral_exemplar (org-scoped) instead of the
// in-memory loop's Map.

import { and, eq, gte, desc } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { enqueueJob, scoreTargetEngagement, labelForZ } from '@axiom/worker';
import { withOrgContext } from './routes/helpers.js';
import type { ViralPersistence, ViralPersistInput, ViralListInput } from '@axiom/relay';

const LABEL_WINDOW_MS = 72 * 3600_000; // L3.5 §1.1: 72h default window

/**
 * Resolve the post_target row for an ingested post. The relay payload's
 * postId is the platform post id (remote_id after publish). Fails closed —
 * metrics for a post AXIOM does not track cannot be persisted honestly.
 */
async function resolveTarget(
  tx: any,
  orgId: string,
  platform: string,
  remoteId: string,
): Promise<{ id: string; bundleId: string }> {
  const rows = await tx
    .select({ id: schema.postTarget.id, bundleId: schema.postTarget.bundleId })
    .from(schema.postTarget)
    .where(
      and(
        eq(schema.postTarget.orgId, orgId),
        eq(schema.postTarget.platform, platform),
        eq(schema.postTarget.remoteId, remoteId),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    throw new Error(`viral.ingest: no post_target for platform=${platform} remote_id=${remoteId}`);
  }
  return rows[0];
}

/**
 * Compute the label with the same math as the viral.label executor
 * (z-score of this target's engagementRate against the 72h window for the
 * target's (model, platform)).
 */
async function computeLabel(
  tx: any,
  orgId: string,
  bundleId: string,
  targetId: string,
  platform: string,
): Promise<'viral' | 'strong' | 'baseline' | 'weak'> {
  const bundles = await tx
    .select({ modelId: schema.contentBundle.modelId })
    .from(schema.contentBundle)
    .where(and(eq(schema.contentBundle.id, bundleId), eq(schema.contentBundle.orgId, orgId)))
    .limit(1);
  if (bundles.length === 0) throw new Error(`viral.ingest: bundle ${bundleId} not found`);
  const modelId = bundles[0].modelId;

  const windowStart = new Date(Date.now() - LABEL_WINDOW_MS);
  const history = await tx
    .select({
      postTargetId: schema.postMetric.postTargetId,
      engagementRate: schema.postMetric.engagementRate,
    })
    .from(schema.postMetric)
    .innerJoin(schema.postTarget, eq(schema.postTarget.id, schema.postMetric.postTargetId))
    .innerJoin(schema.contentBundle, eq(schema.contentBundle.id, schema.postTarget.bundleId))
    .where(
      and(
        eq(schema.contentBundle.orgId, orgId),
        eq(schema.postTarget.orgId, orgId),
        eq(schema.contentBundle.modelId, modelId),
        eq(schema.postMetric.platform, platform),
        gte(schema.postMetric.collectedAt, windowStart),
      ),
    )
    .orderBy(desc(schema.postMetric.collectedAt));

  try {
    return labelForZ(scoreTargetEngagement(history, targetId).perfScore);
  } catch (err) {
    throw new Error(`viral.ingest: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export const relayViralPersistence: ViralPersistence = {
  async persist(
    input: ViralPersistInput,
  ): Promise<{ label: 'viral' | 'strong' | 'baseline' | 'weak' }> {
    const { postId, metrics, orgId } = input;
    if (!orgId) throw new Error('viral.ingest: orgId required');

    return withOrgContext(orgId, async (tx) => {
      const target = await resolveTarget(tx, orgId, metrics.platform, postId);

      const impressions = metrics.impressions ?? 0;
      const engagement = metrics.likes + metrics.comments + metrics.shares + metrics.saves;
      const engagementRate = impressions > 0 ? engagement / impressions : 0;

      await tx.insert(schema.postMetric).values({
        postTargetId: target.id,
        platform: metrics.platform,
        remoteId: postId,
        views: impressions,
        likes: metrics.likes,
        shares: metrics.shares,
        comments: metrics.comments,
        engagementRate,
      });

      // Producer for viral.label (same as metricsPoll): the worker executor
      // writes viral_exemplar / viral_recipe / viral_embedding.
      await enqueueJob(tx, {
        orgId,
        queue: 'viral',
        kind: 'viral.label',
        payload: { targetId: target.id },
        runAfter: new Date(),
      });

      const label = await computeLabel(tx, orgId, target.bundleId, target.id, metrics.platform);
      return { label };
    });
  },

  async listExemplars(input: ViralListInput): Promise<Array<Record<string, unknown>>> {
    const { platform, limit, orgId } = input;
    if (!orgId) throw new Error('viral.exemplars: orgId required');

    return withOrgContext(orgId, async (tx) => {
      const conds = [eq(schema.viralExemplar.orgId, orgId)];
      if (platform !== 'all') conds.push(eq(schema.viralExemplar.platform, platform));

      const rows = await tx
        .select()
        .from(schema.viralExemplar)
        .where(and(...conds))
        .orderBy(desc(schema.viralExemplar.perfScore), desc(schema.viralExemplar.createdAt))
        .limit(limit);

      return rows.map((r: Record<string, unknown>) => r);
    });
  },
};
