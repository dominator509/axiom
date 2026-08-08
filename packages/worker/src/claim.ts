// ─── Claim loop (L3.4 §3) ───
// The worker claims the oldest ready job with SELECT … FOR UPDATE SKIP LOCKED
// via the SECURITY DEFINER claim_job(worker) function (migration 0004). The
// function also sets the org RLS context for the caller's transaction, so all
// subsequent domain work in that txn is tenant-scoped (LBI-02).

import { sql } from 'drizzle-orm';
import type { JobRow } from './types.js';

export interface ClaimResult {
  job: JobRow | null;
  /** True when the queue is empty (no ready job). */
  empty: boolean;
}

/**
 * Claim the next ready job for this worker. Must run inside a transaction —
 * the returned job's org context is set on the session for the rest of it.
 */
export async function claimNextJob(tx: any, workerId: string): Promise<ClaimResult> {
  const res = await tx.execute(sql`SELECT * FROM claim_job(${workerId})`);
  const rows = (res?.rows ?? []) as unknown[];
  if (rows.length === 0) return { job: null, empty: true };
  return { job: rows[0] as JobRow, empty: false };
}
