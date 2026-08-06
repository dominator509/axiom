// ─── metrics.poll executor (L3.4 §2, L2.8 §1) ───
// Polls a published target's platform connector for current insights and
// writes a post_metric row (Timescale-shaped). Producer for viral.label.

import { eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { connectorFor, hasConnector } from '@axiom/connectors';
import { ParkJobError } from './context.js';
import type { Executor, ExecutorContext } from './context.js';

const RATE_BUCKET_PARK_MS = 30_000;

export const metricsPoll: Executor = async (ctx: ExecutorContext) => {
  const { tx, job } = ctx;
  const payload = (job.payload ?? {}) as { targetId?: string };
  const targetId = payload.targetId;
  if (!targetId) throw new Error('metrics.poll: payload.targetId required');

  const targets = await tx
    .select()
    .from(schema.postTarget)
    .where(eq(schema.postTarget.id, targetId))
    .limit(1);
  if (targets.length === 0) throw new Error(`metrics.poll: target ${targetId} not found`);
  const target = targets[0];

  // Only published targets with a remote_id have anything to poll.
  if (target.state !== 'published' || !target.remoteId) {
    // Nothing to collect yet — park briefly; the publish flow re-enqueues
    // after publication, so this is a transient no-op guard.
    throw new ParkJobError('metrics.poll: target not published yet', RATE_BUCKET_PARK_MS);
  }

  const platform = target.platform as Parameters<typeof connectorFor>[0];
  if (!hasConnector(platform)) {
    throw new Error(`metrics.poll: no connector registered for '${platform}'`);
  }
  const connector = connectorFor(platform);

  const collected = await connector.fetchMetrics(target.remoteId, 'day');
  if (!collected) throw new Error(`metrics.poll: connector returned no metrics for ${target.remoteId}`);

  const m = collected.metrics ?? {};
  const impressions = m.impressions ?? m.views ?? 0;
  const likes = m.likes ?? 0;
  const comments = m.comments ?? 0;
  const shares = m.shares ?? m.reposts ?? m.retweets ?? 0;
  const saves = m.saves ?? 0;

  const engagement = likes + comments + shares + saves;
  const engagementRate = impressions > 0 ? engagement / impressions : 0;

  await tx.insert(schema.postMetric).values({
    postTargetId: targetId,
    platform,
    remoteId: target.remoteId,
    views: impressions,
    likes,
    shares,
    comments,
    engagementRate,
    // reach is captured in the raw metrics but post_metric's schema keeps the
    // engagement counters; the viral labeler consumes views/likes/shares/comments.
  });

  // Label the exemplar once enough signal exists (L2.8 §2).
  await tx
    .insert(schema.job)
    .values({
      orgId: job.org_id,
      queue: 'viral',
      kind: 'viral.label',
      payload: { targetId },
      state: 'ready',
      runAfter: new Date(),
    })
    .onConflictDoNothing();
};
