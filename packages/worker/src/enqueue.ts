// ─── Enqueue helper (L3.4 §1) ───
// Producers enqueue jobs inside the SAME transaction as their domain write
// (no dual-write races). dedupe_key collapses duplicate enqueues of the same
// unit of work (L3.4 §4). run_after drives the scheduler (claim ORDER BY).

import { schema } from '@axiom/db';
import { jobDedupeKey } from './idempotency.js';

export interface EnqueueJobInput {
  orgId: string;
  queue: string;
  kind: string;
  payload: Record<string, unknown>;
  /** ISO string or Date; default now. */
  runAfter?: Date;
  /** Unit-of-work parts for the dedupe key. Omit to allow duplicates. */
  dedupeParts?: Array<string | number>;
  maxAttempts?: number;
}

/**
 * Insert a job row via the caller's transaction (org context must be set by
 * the caller — withOrgContext in the API, claim_job in the worker).
 */
export async function enqueueJob(tx: any, input: EnqueueJobInput): Promise<{ id: string } | null> {
  const values = {
    orgId: input.orgId,
    queue: input.queue,
    kind: input.kind,
    payload: input.payload,
    state: 'ready',
    runAfter: input.runAfter ?? new Date(),
    maxAttempts: input.maxAttempts ?? 3,
    dedupeKey: input.dedupeParts ? jobDedupeKey(input.dedupeParts) : null,
  } as const;

  const rows = await tx
    .insert(schema.job)
    .values(values)
    .onConflictDoNothing({ target: [schema.job.orgId, schema.job.dedupeKey] })
    .returning({ id: schema.job.id });

  if (rows.length === 0) return null; // dedupe hit — already enqueued
  return rows[0];
}
