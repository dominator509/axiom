// ─── dlq.replay executor (L3.4 §2) ───
// Idempotent re-run: resets a dead/failed job back to ready with attempts=0
// so the normal claim loop processes it again.

import { eq, and, sql } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { EXTERNAL_SIDE_EFFECT_UNKNOWN_PREFIX, isExternalSideEffectUnknown } from './context.js';
import type { Executor, ExecutorContext } from './context.js';

export const dlqReplay: Executor = async (ctx: ExecutorContext) => {
  const { tx, job } = ctx;
  const payload = (job.payload ?? {}) as { jobId?: string };
  const jobId = payload.jobId;
  if (!jobId) throw new Error('dlq.replay: payload.jobId required');

  const existing = await tx
    .select({ lastError: schema.job.lastError })
    .from(schema.job)
    .where(and(eq(schema.job.id, jobId), eq(schema.job.orgId, job.org_id)))
    .limit(1)
    .for('update');
  if (existing.length > 0 && isExternalSideEffectUnknown(existing[0].lastError)) {
    throw new Error(
      `${EXTERNAL_SIDE_EFFECT_UNKNOWN_PREFIX} replay requires provider reconciliation before retry`,
    );
  }

  const rows = await tx
    .update(schema.job)
    .set({
      state: 'ready',
      attempts: 0,
      lastError: null,
      runAfter: new Date(),
      lockedBy: null,
      lockedAt: null,
    })
    .where(
      and(
        eq(schema.job.id, jobId),
        eq(schema.job.orgId, job.org_id),
        sql`${schema.job.state} IN ('dead', 'failed')`,
      ),
    )
    .returning({ id: schema.job.id });

  if (rows.length === 0) {
    // Nothing to replay (already ready / not found) — idempotent success.
    return;
  }
};
