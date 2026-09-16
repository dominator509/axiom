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

export interface MediaJobTarget {
  orgId: string;
  modelId: string;
  bundleId: string;
  jobId: string;
}

export type MediaWorkerScope = Pick<MediaJobTarget, 'orgId' | 'modelId'>;

export function resolveMediaWorkerScope(env: Record<string, string | undefined>): MediaWorkerScope | undefined {
  const orgId = env.WORKER_MEDIA_ORG_ID;
  const modelId = env.WORKER_MEDIA_MODEL_ID;
  if (orgId === undefined && modelId === undefined) return undefined;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(orgId ?? '') || !uuid.test(modelId ?? ''))
    throw new Error('Both valid media worker scope IDs are required');
  return { orgId: orgId!, modelId: modelId! };
}

/** Existing worker loop, narrowed to this model's unstarted media jobs.
 * Never invokes the global claim/recovery function or retries a prior attempt.
 */
export async function claimNextModelMediaJob(tx: Parameters<typeof claimNextJob>[0], workerId: string,
  scope: MediaWorkerScope): Promise<ClaimResult> {
  resolveMediaWorkerScope({ WORKER_MEDIA_ORG_ID: scope.orgId, WORKER_MEDIA_MODEL_ID: scope.modelId });
  await tx.execute(sql`SELECT set_config('app.current_org_id', ${scope.orgId}, true)`);
  const selected = await tx.execute(sql`SELECT j.id, b.id AS bundle_id FROM job j
    JOIN content_bundle b ON b.id::text=j.payload->>'bundleId' AND b.org_id=j.org_id
    WHERE j.org_id=${scope.orgId}::uuid AND b.model_id=${scope.modelId}::uuid
      AND j.kind IN ('media.generate','tos.scan') AND j.state='ready' AND j.attempts=0
      AND j.max_attempts>0 AND j.locked_by IS NULL AND j.locked_at IS NULL AND j.run_after<=now()
      AND b.state IN ('generated','hold')
      AND NOT EXISTS (SELECT 1 FROM media_generation_attempt a WHERE a.job_id=j.id AND a.org_id=j.org_id)
    ORDER BY j.created_at, j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`);
  const row = selected.rows[0] as { id: string; bundle_id: string } | undefined;
  return row ? claimExactMediaJob(tx, workerId, { ...scope, jobId: row.id, bundleId: row.bundle_id })
    : { job: null, empty: true };
}

/** Bounded operator execution: claim only an explicitly selected first attempt.
 * No global queue sweep, lease recovery, publication, or automatic retry.
 * The caller must commit this claim before using the ordinary processJob path.
 */
export async function claimExactMediaJob(tx: Parameters<typeof claimNextJob>[0], workerId: string,
  target: MediaJobTarget): Promise<ClaimResult> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (![target.orgId, target.modelId, target.bundleId, target.jobId].every(id => typeof id === 'string' && uuid.test(id))
    || !workerId.trim() || workerId.length > 200) throw new Error('Exact media job scope is required');
  await tx.execute(sql`SELECT set_config('app.current_org_id', ${target.orgId}, true)`);
  const result = await tx.execute(sql`
    WITH selected AS (
      SELECT j.id FROM job j JOIN content_bundle b
        ON b.id::text = j.payload->>'bundleId' AND b.org_id = j.org_id
      WHERE j.id = ${target.jobId}::uuid AND j.org_id = ${target.orgId}::uuid
        AND b.id = ${target.bundleId}::uuid AND b.model_id = ${target.modelId}::uuid
        AND j.kind IN ('media.generate', 'tos.scan')
        AND j.state = 'ready' AND j.attempts = 0 AND j.max_attempts > 0
        AND j.locked_by IS NULL AND j.locked_at IS NULL AND j.run_after <= now()
        AND b.state IN ('generated', 'hold')
      FOR UPDATE OF j SKIP LOCKED
    ) UPDATE job j SET state = 'running', locked_by = ${workerId}, locked_at = now()
      FROM selected s WHERE j.id = s.id RETURNING j.*`);
  const rows = result.rows as JobRow[];
  return { job: rows[0] ?? null, empty: rows.length === 0 };
}
