// ─── incident.notify executor (L3.4 §2) ───
// Records a Sev incident into the audit chain and, when payload.jobId is set,
// marks that job dead (DLQ). The Relay page push is channel-side and uses the
// same binding resolution as relay.card.

import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { lockAuditChain, schema } from '@axiom/db';
import { canonicalAuditPayload } from '@axiom/core';
import type { Executor, ExecutorContext } from './context.js';

export const incidentNotify: Executor = async (ctx: ExecutorContext) => {
  const { tx, job } = ctx;
  const payload = (job.payload ?? {}) as { incidentId?: string; jobId?: string; message?: string };
  if (!payload.incidentId) throw new Error('incident.notify: payload.incidentId required');

  const actorRef = `worker:${ctx.workerId}`;
  // Use the same transaction-scoped lock as API audit appends so their chain
  // heads cannot race or require an org-row lock upgrade.
  await lockAuditChain(tx, job.org_id);
  const prev = await tx
    .select({ rowHash: schema.auditLog.rowHash, ts: schema.auditLog.ts })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.orgId, job.org_id))
    .orderBy(desc(schema.auditLog.ts), desc(schema.auditLog.id))
    .limit(1);
  const prevHash: Buffer =
    prev.length > 0 ? Buffer.from(prev[0].rowHash as Uint8Array) : Buffer.alloc(32);
  const now = new Date(Math.max(Date.now(), prev[0]?.ts ? new Date(prev[0].ts).getTime() + 1 : 0));
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
  const canonicalPayload = canonicalAuditPayload(auditPayload);
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
