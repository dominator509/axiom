// ─── viral.insight executor (F-85, L2.8 ↔ L2.7) ────────────────────────────
// Stores a bounded, model-scoped Relay card from published provider evidence.
// This executor never calls a provider and never claims external delivery.

import { sql, and, eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { renderViralInsightCard, resolveOrgDigestLocale } from '@axiom/core';
import type { Executor, ExecutorContext } from './context.js';
import { enqueueJob } from '../enqueue.js';
import { enqueueWeeklyViralInsight } from '../viral-insight-schedule.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WINDOW_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ARM_RE = /^(?:v2:)?(?:short|medium|long):(?:question|statement)(?::hook=(?:question|bold-claim|story|stat|controversy|teaser|unknown):format=(?:reel|carousel|single|story|longform|unknown)(?::time=(?:morning|afternoon|evening|night))?)?$/;
const CONTEXT_RE = /^learn-v[12]:scheduled-utc-(?:unknown|[0-3])$/;

function bounded(value: unknown, max = 96): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function windowBounds(windowKey: string): { start: Date; end: Date } {
  if (!WINDOW_KEY_RE.test(windowKey)) throw new Error('Invalid viral insight window');
  const start = new Date(`${windowKey}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.getUTCDay() !== 1) {
    throw new Error('Viral insight window must be an ISO Monday');
  }
  return { start, end: new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000) };
}

function rowsOf(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value as Array<Record<string, unknown>> : (value as { rows?: Array<Record<string, unknown>> })?.rows ?? [];
}

export const viralInsight: Executor = async (ctx: ExecutorContext) => {
  const { tx, job } = ctx;
  const modelId = job.payload.modelId;
  const windowKey = job.payload.windowKey;
  if (typeof modelId !== 'string' || !UUID_RE.test(modelId)) throw new Error('Invalid viral insight model');
  if (typeof windowKey !== 'string') throw new Error('Invalid viral insight window');
  const { start, end } = windowBounds(windowKey);

  const automaticScheduleId = job.payload.automaticScheduleId;
  if (automaticScheduleId !== undefined) {
    if (typeof automaticScheduleId !== 'string' || !UUID_RE.test(automaticScheduleId))
      throw new Error('Invalid automatic viral insight schedule');
    const [model] = await tx.select({ scheduleId: schema.modelProfile.viralInsightScheduleId })
      .from(schema.modelProfile)
      .where(and(
        eq(schema.modelProfile.orgId, job.org_id),
        eq(schema.modelProfile.id, modelId),
      ))
      .limit(1)
      .for('update');
    // Disabling or replacing a schedule invalidates already-queued work. The
    // next occurrence is chained in the same transaction as this completion.
    if (model?.scheduleId !== automaticScheduleId) return;
    const persistContinuation: NonNullable<ExecutorContext['persistScheduledContinuation']> =
      ctx.persistScheduledContinuation ?? (async <T>(operation: (continuationTx: any) => Promise<T>): Promise<T> => operation(tx));
    await persistContinuation(continuationTx => enqueueWeeklyViralInsight(
      continuationTx, job.org_id, modelId, automaticScheduleId,
    ));
  }

  const raw = await tx.execute(sql`
    SELECT
      ve.platform,
      ve.features->>'learning_arm' AS learning_arm,
      ve.features->>'learning_context' AS learning_context,
      CASE
        WHEN (ve.features->>'published_hour_utc') ~ '^(0|[1-9]|1[0-9]|2[0-3])$'
          THEN (ve.features->>'published_hour_utc')::int
        ELSE NULL
      END AS published_hour_utc,
      count(*)::int AS sample_size,
      avg(ve.perf_score)::float8 AS mean_score
    FROM viral_exemplar ve
    WHERE ve.org_id = ${job.org_id}
      AND ve.model_id = ${modelId}
      AND ve.created_at >= ${start}
      AND ve.created_at < ${end}
      AND ve.features->>'evidence_source' = 'published-provider-snapshot-v2'
      AND (ve.features->>'learning_arm') ~ ${ARM_RE.source}
      AND (ve.features->>'learning_context') ~ ${CONTEXT_RE.source}
      AND ve.perf_score NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
      AND EXISTS (
        SELECT 1
        FROM post_target t
        JOIN content_bundle b ON b.id = t.bundle_id AND b.org_id = t.org_id
        WHERE t.org_id = ve.org_id
          AND t.bundle_id = ve.bundle_id
          AND b.model_id = ve.model_id
          AND t.platform = ve.platform
          AND t.state = 'published'
          AND t.remote_id IS NOT NULL
          AND t.published_at IS NOT NULL
          AND t.published_at <= now()
          AND EXISTS (
            SELECT 1 FROM post_metric pm
            WHERE pm.post_target_id = t.id
              AND pm.source = 'provider'
              AND pm.remote_id = t.remote_id
              AND pm.platform = t.platform
              AND pm.collected_at <= now()
          )
      )
    GROUP BY ve.platform, ve.features->>'learning_arm', ve.features->>'learning_context', published_hour_utc
    HAVING count(*) >= 3
    ORDER BY avg(ve.perf_score) DESC, ve.platform, learning_arm
    LIMIT 5
  `);
  const groups = rowsOf(raw).map(row => ({
    platform: bounded(row.platform, 48) || 'unknown',
    learningArm: bounded(row.learning_arm, 96) || 'unknown',
    learningContext: bounded(row.learning_context, 96) || 'unknown',
    sampleSize: Math.max(0, Number(row.sample_size) || 0),
    meanScore: Number.isFinite(Number(row.mean_score)) ? Number(row.mean_score) : 0,
    publishedHourUtc: row.published_hour_utc == null ? null : Number(row.published_hour_utc),
  }));
  if (groups.length === 0) return;

  const localeRows = await tx.select({
    scope: schema.uiLocalePreference.scope,
    locale: schema.uiLocalePreference.locale,
  }).from(schema.uiLocalePreference).where(eq(schema.uiLocalePreference.orgId, job.org_id));
  const resolved = resolveOrgDigestLocale(localeRows.map((row: { scope: 'user' | 'org'; locale: string }) => ({
    scope: row.scope,
    orgId: job.org_id,
    locale: row.locale,
    updatedAt: '',
  })));
  const card = renderViralInsightCard(resolved.locale, {
    groups,
    totalSamples: groups.reduce((sum, group) => sum + group.sampleSize, 0),
  });
  const externalRef = `viral-insight:${modelId}:${windowKey}`;
  const [sourceCard] = await tx.insert(schema.relayCard).values({
    orgId: job.org_id,
    modelId,
    channel: 'viral_insight',
    externalRef,
    state: 'stored',
    title: card.title,
    description: card.description,
    icon: '📈',
    config: {
      viralInsight: {
        version: 'f85-v1',
        modelId,
        windowKey,
        minimumSample: 3,
        evidenceSource: 'published-provider-snapshot-v2',
        groups,
      },
      externalDelivery: 'not-attempted',
      uiLocale: card.locale,
      uiLocaleSource: resolved.source,
    },
    priority: 4,
  }).onConflictDoNothing().returning({ id: schema.relayCard.id });
  let sourceCardId = sourceCard?.id as string | undefined;
  if (!sourceCardId) {
    // A prior source-only run may have committed the card before dispatch
    // enqueueing was introduced. Recover its identity without creating a
    // second card; the job dedupe key keeps this repair idempotent.
    const existing = await tx.select({ id: schema.relayCard.id })
      .from(schema.relayCard)
      .where(and(
        eq(schema.relayCard.orgId, job.org_id),
        eq(schema.relayCard.modelId, modelId),
        eq(schema.relayCard.channel, 'viral_insight'),
        eq(schema.relayCard.externalRef, externalRef),
        eq(schema.relayCard.state, 'stored'),
      ))
      .limit(1);
    sourceCardId = existing[0]?.id as string | undefined;
  }
  if (sourceCardId) {
    // The source card and its dispatch job share this transaction. The Relay
    // executor creates one pending marker per enabled model binding and never
    // reports local storage as provider delivery.
    await enqueueJob(tx, {
      orgId: job.org_id,
      queue: 'relay',
      kind: 'relay.card',
      payload: { insightCardId: sourceCardId },
      dedupeParts: ['relay.insight', sourceCardId],
    });
  }
};
