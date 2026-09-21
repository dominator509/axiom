// ─── trigger.evaluate executor (F-19) ────────────────────────────────────
// Evaluates persisted model rules against a real post_metric observation.
// Actions are bounded to the existing queue: content generation still flows
// through ToS and approval, while relay cards remain operator decisions.

import { and, desc, eq, gte, ne, sql } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { asPlatform } from '../connection.js';
import { enqueueJob } from '../enqueue.js';
import type { Executor, ExecutorContext } from './context.js';

type TriggerCondition = {
  metric?: 'views' | 'likes' | 'comments' | 'shares' | 'engagementRate';
  thresholdMode?: 'fixed' | 'learned_p90';
  threshold?: number;
  minimumSamples?: number;
  windowMinutes?: number;
};

type TriggerAction = {
  type?: 'content.generate' | 'relay.card';
  prompt?: string;
  style?: string;
  outfit?: string;
  location?: string;
  mood?: string;
  lighting?: string;
  aspectRatio?: '1:1' | '4:5' | '9:16' | '16:9';
  cooldownMinutes?: number;
};

function metricValue(metric: TriggerCondition['metric'], row: Record<string, unknown>): number {
  const value = row[metric ?? 'views'];
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

const DEFAULT_LEARNED_MINIMUM_SAMPLES = 4;
const DEFAULT_LEARNED_WINDOW_MINUTES = 10_080;

/**
 * Validate the aggregate returned by PostgreSQL before a learned rule can
 * fire. Missing or undersampled distributions fail closed instead of
 * treating an absent percentile as zero.
 */
export function resolveLearnedP90Threshold(
  row: { threshold?: unknown; sampleCount?: unknown } | undefined,
  minimumSamples = DEFAULT_LEARNED_MINIMUM_SAMPLES,
): number | null {
  if (!Number.isInteger(minimumSamples) || minimumSamples < DEFAULT_LEARNED_MINIMUM_SAMPLES || minimumSamples > 1_000) return null;
  const threshold = Number(row?.threshold);
  const sampleCount = Number(row?.sampleCount);
  if (!Number.isFinite(threshold) || !Number.isInteger(sampleCount) || sampleCount < minimumSamples) return null;
  return threshold;
}

function metricColumn(metric: NonNullable<TriggerCondition['metric']>) {
  switch (metric) {
    case 'views': return schema.postMetric.views;
    case 'likes': return schema.postMetric.likes;
    case 'comments': return schema.postMetric.comments;
    case 'shares': return schema.postMetric.shares;
    case 'engagementRate': return schema.postMetric.engagementRate;
  }
}

async function learnedP90Threshold(
  tx: any,
  input: {
    orgId: string;
    modelId: string;
    platform: string;
    targetId: string;
    metric: NonNullable<TriggerCondition['metric']>;
    windowMinutes?: number;
    minimumSamples?: number;
  },
): Promise<number | null> {
  const minimumSamples = input.minimumSamples ?? DEFAULT_LEARNED_MINIMUM_SAMPLES;
  const windowMinutes = input.windowMinutes ?? DEFAULT_LEARNED_WINDOW_MINUTES;
  if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > DEFAULT_LEARNED_WINDOW_MINUTES) return null;

  const [row] = await tx.select({
    threshold: sql<number>`percentile_cont(0.9) within group (order by ${metricColumn(input.metric)})`,
    sampleCount: sql<number>`count(*)`,
  }).from(schema.postMetric)
    .innerJoin(schema.postTarget, eq(schema.postTarget.id, schema.postMetric.postTargetId))
    .innerJoin(schema.contentBundle, eq(schema.contentBundle.id, schema.postTarget.bundleId))
    .where(and(
      eq(schema.postTarget.orgId, input.orgId),
      eq(schema.contentBundle.orgId, input.orgId),
      eq(schema.contentBundle.modelId, input.modelId),
      eq(schema.postMetric.platform, input.platform),
      eq(schema.postTarget.platform, input.platform),
      eq(schema.postMetric.source, 'provider'),
      eq(schema.postTarget.state, 'published'),
      eq(schema.postMetric.remoteId, schema.postTarget.remoteId),
      ne(schema.postMetric.postTargetId, input.targetId),
      gte(schema.postMetric.collectedAt, new Date(Date.now() - windowMinutes * 60_000)),
    ))
    .limit(1);
  return resolveLearnedP90Threshold(row, minimumSamples);
}

export const triggerEvaluate: Executor = async ({ tx, job }: ExecutorContext) => {
  const targetId = typeof job.payload?.targetId === 'string' ? job.payload.targetId : null;
  if (!targetId) throw new Error('trigger.evaluate: payload.targetId required');

  const targets = await tx.select({
    id: schema.postTarget.id,
    platform: schema.postTarget.platform,
    bundleId: schema.postTarget.bundleId,
  }).from(schema.postTarget).where(and(
    eq(schema.postTarget.id, targetId),
    eq(schema.postTarget.orgId, job.org_id),
  )).limit(1);
  const target = targets[0];
  if (!target) throw new Error(`trigger.evaluate: target ${targetId} not found`);

  const bundles = await tx.select({ modelId: schema.contentBundle.modelId }).from(schema.contentBundle)
    .where(and(eq(schema.contentBundle.id, target.bundleId), eq(schema.contentBundle.orgId, job.org_id))).limit(1);
  const modelId = bundles[0]?.modelId;
  if (!modelId) throw new Error(`trigger.evaluate: bundle ${target.bundleId} not found`);

  let platform: string;
  try { platform = asPlatform(target.platform); } catch { return; }
  const rules = await tx.select().from(schema.triggerRule).where(and(
    eq(schema.triggerRule.orgId, job.org_id),
    eq(schema.triggerRule.modelId, modelId),
    eq(schema.triggerRule.platform, platform),
    eq(schema.triggerRule.enabled, true),
  ));
  if (rules.length === 0) return;

  const metrics = await tx.select().from(schema.postMetric)
    .where(eq(schema.postMetric.postTargetId, targetId))
    .orderBy(desc(schema.postMetric.collectedAt)).limit(1);
  const metric = metrics[0] as unknown as Record<string, unknown> | undefined;
  if (!metric) return;
  const now = Date.now();

  for (const rule of rules) {
    const condition = (rule.condition ?? {}) as TriggerCondition;
    const action = (rule.action ?? {}) as TriggerAction;
    if (!condition.metric) continue;

    const threshold = condition.thresholdMode === 'learned_p90'
      ? await learnedP90Threshold(tx, {
        orgId: job.org_id,
        modelId,
        platform,
        targetId,
        metric: condition.metric,
        windowMinutes: condition.windowMinutes,
        minimumSamples: condition.minimumSamples,
      })
      : typeof condition.threshold === 'number' && Number.isFinite(condition.threshold)
        ? condition.threshold
        : null;
    if (threshold === null || metricValue(condition.metric, metric) < threshold) continue;

    const cooldownMinutes = action.cooldownMinutes ?? 60;
    const lastFired = rule.lastFiredAt ? new Date(rule.lastFiredAt).getTime() : 0;
    if (lastFired > 0 && now - lastFired < cooldownMinutes * 60_000) continue;

    const bucket = Math.floor(now / (cooldownMinutes * 60_000));
    if (action.type === 'relay.card') {
      await enqueueJob(tx, {
        orgId: job.org_id,
        queue: 'relay',
        kind: 'relay.card',
        payload: { bundleId: target.bundleId },
        runAfter: new Date(),
        dedupeParts: ['trigger.relay.card', rule.id, target.bundleId, bucket],
      });
    } else if (action.type === 'content.generate') {
      await enqueueJob(tx, {
        orgId: job.org_id,
        queue: 'content',
        kind: 'content.generate',
        payload: {
          modelId,
          platform,
          prompt: action.prompt,
          style: action.style,
          outfit: action.outfit,
          location: action.location,
          mood: action.mood,
          lighting: action.lighting,
          aspectRatio: action.aspectRatio,
        },
        runAfter: new Date(),
        dedupeParts: ['trigger.content.generate', rule.id, target.id, bucket],
      });
    } else {
      continue;
    }
    await tx.update(schema.triggerRule).set({ lastFiredAt: new Date(now) }).where(and(
      eq(schema.triggerRule.id, rule.id),
      eq(schema.triggerRule.orgId, job.org_id),
      eq(schema.triggerRule.enabled, true),
    ));
  }
};
