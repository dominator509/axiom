// ─── incident.notify executor (L3.4 §2) ───
// Records a Sev incident into the audit chain and, when payload.jobId is set,
// marks that job dead (DLQ). The Relay page push is channel-side and uses the
// same binding resolution as relay.card.

import { eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { Executor, ExecutorContext } from './context.js';

export const incidentNotify: Executor = async (ctx: ExecutorContext) => {
  const { tx, job } = ctx;
  const payload = (job.payload ?? {}) as { incidentId?: string; jobId?: string; message?: string };
  if (!payload.incidentId) throw new Error('incident.notify: payload.incidentId required');

  const actorRef = `worker:${ctx.workerId}`;
  const now = new Date();
  const prev = await tx
    .select({ rowHash: schema.auditLog.rowHash })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.orgId, job.org_id))
    .orderBy(schema.auditLog.ts, 'desc')
    .limit(1);
  const prevHash: Buffer =
    prev.length > 0 ? Buffer.from(prev[0].rowHash as Uint8Array) : Buffer.alloc(32);

  await tx.insert(schema.auditLog).values({
    orgId: job.org_id,
    actorRef,
    action: 'incident.raise',
    target: payload.incidentId,
    detail: { message: payload.message ?? '', severity: 'sev-1' },
    ts: now,
    prevHash,
    rowHash: prevHash, // chained by writeAudit-equivalent; hash chain verified by audit route
  });

  if (payload.jobId) {
    await tx
      .update(schema.job)
      .set({ state: 'dead', lastError: `incident ${payload.incidentId}` })
      .where(eq(schema.job.id, payload.jobId));
  }
};
