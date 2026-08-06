// ─── viral.label executor (L3.4 §2, L2.8 / L3.5) ───
// Measures → normalizes → labels → embeds → stores:
//  1. Pull post_metric history for the target's (model, platform).
//  2. Compute perf_score = z(weighted engagement) against the trailing window.
//  3. Label: z≥2 viral, 1≤z<2 strong, -1≤z<1 baseline, z<-1 weak (L3.5 §1.3).
//  4. Write viral_exemplar (vector(768) via embedFeatures) + viral_recipe +
//     viral_embedding (HNSW-indexed) in the same txn.

import { eq, and, gte, desc } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { embedFeatures } from '../embedding.js';
import type { Executor, ExecutorContext } from './context.js';

const LABEL_THRESHOLDS = { viral: 2, strong: 1, baseline: -1, weak: -Infinity };

export function labelForZ(z: number): 'viral' | 'strong' | 'baseline' | 'weak' {
  if (z >= LABEL_THRESHOLDS.viral) return 'viral';
  if (z >= LABEL_THRESHOLDS.strong) return 'strong';
  if (z >= LABEL_THRESHOLDS.baseline) return 'baseline';
  return 'weak';
}

export const viralLabel: Executor = async (ctx: ExecutorContext) => {
  const { tx, job } = ctx;
  const payload = (job.payload ?? {}) as { targetId?: string };
  const targetId = payload.targetId;
  if (!targetId) throw new Error('viral.label: payload.targetId required');

  const targets = await tx
    .select()
    .from(schema.postTarget)
    .where(eq(schema.postTarget.id, targetId))
    .limit(1);
  if (targets.length === 0) throw new Error(`viral.label: target ${targetId} not found`);
  const target = targets[0];

  const bundles = await tx
    .select()
    .from(schema.contentBundle)
    .where(eq(schema.contentBundle.id, target.bundleId))
    .limit(1);
  if (bundles.length === 0) throw new Error(`viral.label: bundle ${target.bundleId} not found`);
  const bundle = bundles[0];

  // 1. Trailing window of this model+platform's performance (L3.5 §1.1: 72h default).
  const windowStart = new Date(Date.now() - 72 * 3600_000);
  const history = await tx
    .select({
      views: schema.postMetric.views,
      likes: schema.postMetric.likes,
      shares: schema.postMetric.shares,
      comments: schema.postMetric.comments,
      engagementRate: schema.postMetric.engagementRate,
    })
    .from(schema.postMetric)
    .innerJoin(schema.postTarget, eq(schema.postTarget.id, schema.postMetric.postTargetId))
    .innerJoin(schema.contentBundle, eq(schema.contentBundle.id, schema.postTarget.bundleId))
    .where(
      and(
        eq(schema.contentBundle.modelId, bundle.modelId),
        eq(schema.postMetric.platform, target.platform),
        gte(schema.postMetric.collectedAt, windowStart),
      ),
    )
    .orderBy(desc(schema.postMetric.collectedAt));

  if (history.length === 0) {
    throw new Error('viral.label: no post_metric history for (model, platform) window');
  }

  // 2. Perf score: z-score of the target's own engagement against the window.
  const values = history.map((h: { engagementRate: number }) => h.engagementRate);
  const mean = values.reduce((a: number, b: number) => a + b, 0) / values.length;
  const variance = values.reduce((a: number, b: number) => a + (b - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  const own = history[0]?.engagementRate ?? 0;
  const perfScore = std === 0 ? 0 : (own - mean) / std;

  // 3. Label (L3.5 §1.3).
  const label = labelForZ(perfScore);

  // 4. Feature record + embedding (L3.5 §1.4).
  const captions = (bundle.captions as Record<string, string> | null) ?? {};
  const features: Record<string, unknown> = {
    platform: target.platform,
    caption: captions[target.platform] ?? '',
    hashtags: bundle.hashtags ?? [],
    perf_score: perfScore,
    label,
    window_count: history.length,
    window_mean: mean,
    window_std: std,
  };
  const embedding = embedFeatures(features);

  // Upsert exemplar keyed by (model_id, bundle_id, platform) — re-labeling an
  // existing exemplar is idempotent.
  const existing = await tx
    .select({ id: schema.viralExemplar.id })
    .from(schema.viralExemplar)
    .where(
      and(
        eq(schema.viralExemplar.modelId, bundle.modelId),
        eq(schema.viralExemplar.bundleId, bundle.id),
        eq(schema.viralExemplar.platform, target.platform),
      ),
    )
    .limit(1);

  const exemplarValues = {
    orgId: job.org_id,
    modelId: bundle.modelId,
    bundleId: bundle.id,
    platform: target.platform,
    features,
    embedding,
    perfScore,
    label,
  };

  if (existing.length > 0) {
    await tx
      .update(schema.viralExemplar)
      .set(exemplarValues)
      .where(eq(schema.viralExemplar.id, existing[0].id));
  } else {
    await tx.insert(schema.viralExemplar).values(exemplarValues);
  }

  // Recipe + embedding (L2.8 F-81/F-82).
  const [recipe] = await tx
    .insert(schema.viralRecipe)
    .values({
      orgId: job.org_id,
      modelId: bundle.modelId,
      platform: target.platform,
      label,
      perfScore,
      recipe: features,
      realizedMetrics: {
        views: history[0]?.views ?? 0,
        likes: history[0]?.likes ?? 0,
        shares: history[0]?.shares ?? 0,
        comments: history[0]?.comments ?? 0,
        engagementRate: history[0]?.engagementRate ?? 0,
      },
    })
    .returning();

  await tx
    .insert(schema.viralEmbedding)
    .values({
      orgId: job.org_id,
      recipeId: recipe.id,
      modelId: bundle.modelId,
      platform: target.platform,
      embedding,
    })
    .onConflictDoNothing();
};
