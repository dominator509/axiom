// ─── Claim loop (L3.4 §3) ───
// The worker claims the oldest ready job with SELECT … FOR UPDATE SKIP LOCKED
// via the SECURITY DEFINER claim_job(worker) function (migration 0004). The
// function also sets the org RLS context for the caller's transaction, so all
// subsequent domain work in that txn is tenant-scoped (LBI-02).

import { sql } from 'drizzle-orm';
import { readlinkSync } from 'node:fs';
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

/** Jobs whose executor can create provider or scraper network traffic. When
 * confinement is enabled they are claimable only by the model namespace
 * runner; malformed payloads are deliberately not eligible for fallback. */
export const EGRESS_JOB_KINDS = [
  'publish.target', 'metrics.poll', 'scrape.run', 'fanvue.analytics.sync',
] as const;

export interface EgressWorkerScope {
  modelId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveEgressWorkerScope(env: Record<string, string | undefined>): EgressWorkerScope | undefined {
  const modelId = env.WORKER_EGRESS_MODEL_ID;
  const runner = env.AXIOM_EGRESS_RUNNER;
  if (modelId === undefined && runner === undefined) return undefined;
  if (!UUID.test(modelId ?? '') || runner !== '1') {
    throw new Error('A model-scoped egress runner requires WORKER_EGRESS_MODEL_ID and AXIOM_EGRESS_RUNNER=1');
  }
  return { modelId: modelId! };
}

/** Opt in explicitly. A malformed value is never interpreted as disabled. */
export function resolveEgressConfinementRequired(env: Record<string, string | undefined>): boolean {
  const required = env.AXIOM_EGRESS_CONFINEMENT_REQUIRED;
  if (required === undefined) return false;
  if (required !== '1') throw new Error('AXIOM_EGRESS_CONFINEMENT_REQUIRED must be exactly 1 when set');
  return true;
}

/** The service manager joins this process to the model namespace; verify the
 * kernel identity before it can claim a provider-bound job. */
export function assertEgressWorkerNamespace(
  scope: EgressWorkerScope,
  options: { platform?: NodeJS.Platform; readlink?: (path: string) => string } = {},
): void {
  const platform = options.platform ?? process.platform;
  const readlink = options.readlink ?? readlinkSync;
  if (platform !== 'linux') throw new Error('Model egress workers require a Linux network namespace');
  const expected = readlink(`/run/netns/egress_${scope.modelId}`);
  const actual = readlink('/proc/self/ns/net');
  if (actual !== expected) throw new Error('Model egress worker is not running in its assigned network namespace');
}

export async function claimNextModelEgressJob(
  tx: Parameters<typeof claimNextJob>[0], workerId: string, scope: EgressWorkerScope,
): Promise<ClaimResult> {
  resolveEgressWorkerScope({ WORKER_EGRESS_MODEL_ID: scope.modelId, AXIOM_EGRESS_RUNNER: '1' });
  const res = await tx.execute(sql`SELECT * FROM claim_model_egress_job(${workerId}, ${scope.modelId}::uuid)`);
  const rows = (res?.rows ?? []) as unknown[];
  if (rows.length === 0) return { job: null, empty: true };
  return { job: rows[0] as JobRow, empty: false };
}

export async function claimNextNonEgressJob(tx: Parameters<typeof claimNextJob>[0], workerId: string): Promise<ClaimResult> {
  const res = await tx.execute(sql`SELECT * FROM claim_non_egress_job(${workerId})`);
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
  if (row) return claimExactMediaJob(tx, workerId, { ...scope, jobId: row.id, bundleId: row.bundle_id });
  // Local transforms have operation IDs rather than bundle IDs. Keep the
  // scope in the claim itself; never fall back to the global queue function.
  const transformed = await tx.execute(sql`
    WITH selected AS (
      SELECT j.id FROM job j JOIN media_operation o
        ON o.id::text=j.payload->>'operationId' AND o.org_id=j.org_id
      JOIN asset a ON a.id=o.source_asset_id AND a.org_id=o.org_id AND a.model_id=o.model_id
      WHERE j.org_id=${scope.orgId}::uuid AND o.model_id=${scope.modelId}::uuid
        AND j.kind='media.transform' AND o.state='queued'
        AND j.state='ready' AND j.attempts=0 AND j.max_attempts>0
        AND j.locked_by IS NULL AND j.locked_at IS NULL AND j.run_after<=now()
      ORDER BY j.created_at, j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED
    ) UPDATE job j SET state='running', locked_by=${workerId}, locked_at=now()
      FROM selected s WHERE j.id=s.id RETURNING j.*`);
  const jobs = transformed.rows as JobRow[];
  return { job: jobs[0] ?? null, empty: jobs.length === 0 };
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
