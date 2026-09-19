import { enqueueJob } from './enqueue.js';

/** Next Monday 00:00 UTC, strictly after now. Missed weeks are not replayed. */
export function nextDigestAt(now: Date): Date {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid digest clock');
  const days = 7 - ((now.getUTCDay() + 6) % 7);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
}

export async function enqueueWeeklyDigest(tx: any, orgId: string, scheduleId: string, now = new Date()) {
  const runAfter = nextDigestAt(now);
  return enqueueJob(tx, { orgId, queue: 'digest', kind: 'digest.weekly', runAfter,
    payload: { automaticScheduleId: scheduleId, week: runAfter.toISOString().slice(0, 10) },
    dedupeParts: ['digest.weekly.auto', scheduleId, runAfter.toISOString()] });
}
