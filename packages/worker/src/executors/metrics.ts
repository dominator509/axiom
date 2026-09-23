// ─── metrics.poll executor (L3.4 §2, L2.8 §1) ───
// Polls a published target's platform connector for current insights and
// writes a post_metric row (Timescale-shaped). Producer for viral.label.

import { and, eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { asPlatform, connectorForTarget } from '../connection.js';
import { enqueueJob } from '../enqueue.js';
import { ParkJobError } from './context.js';
import type { Executor, ExecutorContext } from './context.js';

const RATE_BUCKET_PARK_MS = 30_000;
export const METRICS_PUBLISH_AGE_OFFSETS_MS = [
  60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
  7 * 24 * 60 * 60_000,
  14 * 24 * 60 * 60_000,
  30 * 24 * 60 * 60_000,
  60 * 24 * 60 * 60_000,
  90 * 24 * 60 * 60_000,
] as const;

/** Reject absent/invalid observations rather than teach the learner invented zeros. */
export function normalizeEngagementMetrics(metrics: Record<string, number | undefined>) {
  const names = ['impressions', 'views', 'likes', 'comments', 'shares', 'reposts', 'retweets', 'saves'];
  for (const name of names) {
    const value = metrics[name];
    if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0))
      throw new Error(`metrics.poll: invalid ${name} counter`);
  }
  const impressions = metrics.impressions ?? metrics.views;
  if (impressions === undefined) throw new Error('metrics.poll: provider supplied no view or impression observation');
  if (!['likes', 'comments', 'shares', 'reposts', 'retweets', 'saves'].some(name => metrics[name] !== undefined))
    throw new Error('metrics.poll: provider supplied no engagement observation');
  const likes = metrics.likes ?? 0, comments = metrics.comments ?? 0;
  const shares = metrics.shares ?? metrics.reposts ?? metrics.retweets ?? 0, saves = metrics.saves ?? 0;
  const engagement = likes + comments + shares + saves;
  if (!Number.isSafeInteger(engagement)) throw new Error('metrics.poll: engagement counter overflow');
  if (impressions === 0 && engagement > 0) throw new Error('metrics.poll: engagement has no observed denominator');
  return { impressions, likes, comments, shares, engagementRate: impressions > 0 ? engagement / impressions : 0 };
}

/** Poll around the product's 1h/6h/24h/7d windows, then decay to sparse snapshots. */
export function nextMetricsPollAt(publishedAt: Date | string, now = new Date()): Date | null {
  const published = new Date(publishedAt);
  if (!Number.isFinite(published.getTime()) || !Number.isFinite(now.getTime())) throw new Error('metrics.poll: invalid schedule time');
  const age = Math.max(0, now.getTime() - published.getTime());
  const nextOffset = METRICS_PUBLISH_AGE_OFFSETS_MS.find(offset => offset > age);
  return nextOffset === undefined ? null : new Date(published.getTime() + nextOffset);
}

export function metricsPollDedupeParts(targetId: string, runAt: Date): string[] {
  return ['metrics.poll', targetId, runAt.toISOString()];
}

export const metricsPoll: Executor = async (ctx: ExecutorContext) => {
  const { tx, job } = ctx;
  const payload = (job.payload ?? {}) as { targetId?: string };
  const targetId = payload.targetId;
  if (!targetId) throw new Error('metrics.poll: payload.targetId required');

  const targets = await tx
    .select()
    .from(schema.postTarget)
    .where(and(eq(schema.postTarget.id, targetId), eq(schema.postTarget.orgId, job.org_id)))
    .limit(1);
  if (targets.length === 0) throw new Error(`metrics.poll: target ${targetId} not found`);
  const target = targets[0];

  // Only published targets with a remote_id have anything to poll.
  if (target.state !== 'published' || !target.remoteId) {
    // Nothing to collect yet — park briefly; the publish flow re-enqueues
    // after publication, so this is a transient no-op guard.
    throw new ParkJobError('metrics.poll: target not published yet', RATE_BUCKET_PARK_MS);
  }

  const bundles = await tx
    .select({ modelId: schema.contentBundle.modelId })
    .from(schema.contentBundle)
    .where(
      and(eq(schema.contentBundle.id, target.bundleId), eq(schema.contentBundle.orgId, job.org_id)),
    )
    .limit(1);
  if (bundles.length === 0) {
    throw new Error(`metrics.poll: bundle ${target.bundleId} not found`);
  }

  const platform = asPlatform(target.platform);
  const { connection, connector } = await connectorForTarget(tx, job.org_id, bundles[0].modelId, {
    connectionId: target.connectionId,
    platform,
  });
  if (!target.connectionId) {
    await tx
      .update(schema.postTarget)
      .set({ connectionId: connection.id })
      .where(and(eq(schema.postTarget.id, targetId), eq(schema.postTarget.orgId, job.org_id)));
  }

  // A connector that declares no metrics is intentionally not a producer of
  // post_metric rows. Treating its empty response as zero-valued provider data
  // would poison engagement and viral scoring.
  if (connector.capability().metrics.length === 0) return;

  const collected = await connector.fetchMetrics(target.remoteId, 'day');
  if (!collected)
    throw new Error(`metrics.poll: connector returned no metrics for ${target.remoteId}`);

  const { impressions, likes, comments, shares, engagementRate } = normalizeEngagementMetrics(collected.metrics ?? {});

  await tx.insert(schema.postMetric).values({
    postTargetId: targetId,
    platform,
    remoteId: target.remoteId,
    source: 'provider',
    views: impressions,
    likes,
    shares,
    comments,
    engagementRate,
    // reach is captured in the raw metrics but post_metric's schema keeps the
    // engagement counters; the viral labeler consumes views/likes/shares/comments.
  });

  // Evaluate persisted model rules against this real observation. The
  // evaluator can only enqueue approval-bound work; it never publishes.
  await enqueueJob(tx, {
    orgId: job.org_id,
    queue: 'triggers',
    kind: 'trigger.evaluate',
    payload: { targetId },
    runAfter: new Date(),
    dedupeParts: ['trigger.evaluate', targetId, job.id],
  });

  // Label the exemplar once enough signal exists (L2.8 §2).
  await enqueueJob(tx, {
    orgId: job.org_id,
    queue: 'viral',
    kind: 'viral.label',
    payload: { targetId },
    runAfter: new Date(),
    maxAttempts: job.max_attempts,
    // A later metrics poll should create its own label refresh, while a
    // retry of this exact poll must not create duplicate label jobs.
    dedupeParts: ['viral.label', targetId, job.id],
  });

  // Keep the measure → label loop alive. The initial poll is enqueued by the
  // publish executor; every successful poll owns the next cadence slot. A
  // time-bucketed dedupe key collapses duplicate schedulers without merging
  // distinct future polls.
  const nextRunAt = nextMetricsPollAt(target.publishedAt ?? target.createdAt);
  if (nextRunAt) {
    await enqueueJob(tx, {
      orgId: job.org_id,
      queue: 'metrics',
      kind: 'metrics.poll',
      payload: { targetId },
      runAfter: nextRunAt,
      maxAttempts: job.max_attempts,
      dedupeParts: metricsPollDedupeParts(targetId, nextRunAt),
    });
  }
};
