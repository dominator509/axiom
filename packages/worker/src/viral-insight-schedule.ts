import { enqueueJob } from './enqueue.js';

/** Next Monday 00:00 UTC, strictly after now. Missed weeks are not replayed. */
export function nextViralInsightAt(now: Date): Date {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid viral insight clock');
  const days = 7 - ((now.getUTCDay() + 6) % 7);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
}

/**
 * Queue an opt-in model schedule for the next completed UTC week. The job runs
 * at the boundary after that week, so its window is the preceding Monday-Sunday.
 */
export async function enqueueWeeklyViralInsight(
  tx: any,
  orgId: string,
  modelId: string,
  scheduleId: string,
  now = new Date(),
) {
  const runAfter = nextViralInsightAt(now);
  const completedWeek = new Date(runAfter.getTime() - 7 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  return enqueueJob(tx, {
    orgId,
    queue: 'viral',
    kind: 'viral.insight',
    runAfter,
    payload: { modelId, windowKey: completedWeek, automaticScheduleId: scheduleId },
    dedupeParts: ['viral.insight.auto', scheduleId, runAfter.toISOString()],
  });
}
