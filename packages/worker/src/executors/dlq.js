// ─── dlq.replay executor (L3.4 §2) ───
// Idempotent re-run: resets a dead/failed job back to ready with attempts=0
// so the normal claim loop processes it again.
import { eq, and, sql } from 'drizzle-orm';
import { schema } from '@axiom/db';
export const dlqReplay = async (ctx) => {
    const { tx, job } = ctx;
    const payload = (job.payload ?? {});
    const jobId = payload.jobId;
    if (!jobId)
        throw new Error('dlq.replay: payload.jobId required');
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
        .where(and(eq(schema.job.id, jobId), eq(schema.job.orgId, job.org_id), sql `${schema.job.state} IN ('dead', 'failed')`))
        .returning({ id: schema.job.id });
    if (rows.length === 0) {
        // Nothing to replay (already ready / not found) — idempotent success.
        return;
    }
};
//# sourceMappingURL=dlq.js.map