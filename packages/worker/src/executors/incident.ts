// ─── incident.notify executor (L3.4 §2) ───
// Records a Sev incident into the audit chain and, when payload.jobId is set,
// marks that job dead (DLQ). The Relay page push is channel-side and uses the
// same binding resolution as relay.card.

import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
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
  const detail = { message: payload.message ?? '', severity: 'sev-1' };
  const auditPayload = {
    org_id: job.org_id,
    actor_ref: actorRef,
    action: 'incident.raise',
    target: payload.incidentId,
    detail,
    ts: now.toISOString(),
    prev_hash: prevHash.toString('hex'),
  };
  const canonicalPayload = JSON.stringify(auditPayload, Object.keys(auditPayload).sort());
  const rowHash = createHash('sha256').update(canonicalPayload).digest();

  await tx.insert(schema.auditLog).values({
    orgId: job.org_id,
    actorRef,
    action: 'incident.raise',
    target: payload.incidentId,
    detail,
    ts: now,
    prevHash,
    rowHash,
  });

  if (payload.jobId) {
    await tx
      .update(schema.job)
      .set({ state: 'dead', lastError: `incident ${payload.incidentId}` })
      .where(and(eq(schema.job.id, payload.jobId), eq(schema.job.orgId, job.org_id)));
  }
};
