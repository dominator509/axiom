// ─── Shared API route helpers ─────────────────────────────────────────────
// Org-scoped DB access (RLS LBI-02) + hash-chained audit writes (LBI-08).
// Every dashboard route uses these so tenant isolation and auditability are
// enforced in one place, defense-in-depth on top of Postgres RLS.

import { sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { db, schema } from '@axiom/db';
import { problem } from '../contract.js';

/**
 * Emit an RFC-7807 problem+json error envelope (L3.0) with the request's
 * correlation_id. Replaces the legacy `{ error: { message } }` shape so every
 * route error carries type/title/status/detail/correlation_id.
 */
export function apiError(
  c: Context,
  status: number,
  title: string,
  detail: string,
  extra?: Record<string, unknown>,
): Response {
  const correlationId = (c.get('correlationId') as string) ?? randomUUID();
  return c.json(
    problem(status, title, detail, correlationId, extra) as unknown as object,
    status as 400 | 401 | 402 | 403 | 404 | 408 | 409 | 422 | 429 | 500 | 502 | 503 | 504,
  );
}

/** Standard RFC-7807 title for a status code. */
export function statusTitle(status: number): string {
  const titles: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    402: 'Payment Required',
    403: 'Forbidden',
    404: 'Not Found',
    408: 'Request Timeout',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
  };
  return titles[status] ?? 'Error';
}

/**
 * Run a callback inside a transaction with the org RLS context set.
 * Postgres applies app.current_org_id to every FORCE RLS policy.
 */
export async function withOrgContext<T>(
  orgId: string,
  fn: (tx: any) => Promise<T> | T,
): Promise<T> {
  return db.transaction<T>(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    return await fn(tx);
  });
}

/** Require orgId from the auth middleware; 401 when missing. */
export function requireOrg(c: Context): string | null {
  const orgId = c.get('orgId') as string | undefined;
  if (!orgId) return null;
  return orgId;
}

/** Resolve a model's owning org — used to scope nested model resources. */
export async function modelOrgId(
  tx: any,
  modelId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ orgId: schema.modelProfile.orgId })
    .from(schema.modelProfile)
    .where(sql`${schema.modelProfile.id} = ${modelId}`)
    .limit(1);
  return rows.length > 0 ? (rows[0].orgId as string) : null;
}

/** Canonical serialization for the audit chain (deterministic JSON). */
export function canonical(o: unknown): string {
  return JSON.stringify(o, Object.keys(o as object).sort());
}

/** Append a hash-chained audit entry (LBI-08). Must run inside org context. */
export async function writeAudit(
  tx: any,
  orgId: string,
  actorRef: string,
  action: string,
  target: string,
  detail: Record<string, unknown>,
): Promise<{ prevHash: Buffer; rowHash: Buffer }> {
  // Latest chain head for this org
  const prev = await tx
    .select({ rowHash: schema.auditLog.rowHash })
    .from(schema.auditLog)
    .where(sql`${schema.auditLog.orgId} = ${orgId}`)
    .orderBy(sql`${schema.auditLog.ts} DESC, ${schema.auditLog.id} DESC`)
    .limit(1);
  const prevHash: Buffer =
    prev.length > 0 && prev[0].rowHash
      ? Buffer.from(prev[0].rowHash as Uint8Array)
      : Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex');

  const ts = new Date();
  const payload = canonical({
    org_id: orgId,
    actor_ref: actorRef,
    action,
    target,
    detail,
    ts: ts.toISOString(),
    prev_hash: prevHash.toString('hex'),
  });
  const rowHash = createHash('sha256').update(payload).digest();

  await tx.insert(schema.auditLog).values({
    orgId,
    actorRef,
    action,
    target,
    detail,
    ts,
    prevHash,
    rowHash,
  });

  return { prevHash, rowHash };
}

/** Verify a stored audit chain for an org (LBI-08). Returns per-row results. */
export async function verifyAuditChain(
  tx: any,
  orgId: string,
): Promise<{ rows: number; valid: boolean; brokenAt?: string }> {
  const rows = await tx
    .select({
      id: schema.auditLog.id,
      ts: schema.auditLog.ts,
      action: schema.auditLog.action,
      prevHash: schema.auditLog.prevHash,
      rowHash: schema.auditLog.rowHash,
      actorRef: schema.auditLog.actorRef,
      target: schema.auditLog.target,
      detail: schema.auditLog.detail,
    })
    .from(schema.auditLog)
    .where(sql`${schema.auditLog.orgId} = ${orgId}`)
    .orderBy(sql`${schema.auditLog.ts} ASC, ${schema.auditLog.id} ASC`);

  let prev: Buffer = Buffer.from(
    '0000000000000000000000000000000000000000000000000000000000000000',
    'hex',
  );
  for (const row of rows) {
    const storedPrev = Buffer.from(row.prevHash as Uint8Array);
    const storedRow = Buffer.from(row.rowHash as Uint8Array);
    if (!storedPrev.equals(prev)) {
      return { rows: rows.length, valid: false, brokenAt: `${row.action}@${row.ts}` };
    }
    // Genesis head (migration 0000 seeds row_hash = sha256('genesis') with
    // zero prev_hash) — a fixed chain anchor, not a canonical serialization.
    if (row.action === 'genesis' && row.actorRef === 'system') {
      const expected = createHash('sha256').update('genesis').digest();
      if (!expected.equals(storedRow)) {
        return { rows: rows.length, valid: false, brokenAt: `${row.action}@${row.ts}` };
      }
      prev = storedRow;
      continue;
    }
    const payload = canonical({
      org_id: orgId,
      actor_ref: row.actorRef,
      action: row.action,
      target: row.target,
      detail: row.detail,
      ts: new Date(row.ts).toISOString(),
      prev_hash: storedPrev.toString('hex'),
    });
    const expected = createHash('sha256').update(payload).digest();
    if (!expected.equals(storedRow)) {
      return { rows: rows.length, valid: false, brokenAt: `${row.action}@${row.ts}` };
    }
    prev = storedRow;
  }
  return { rows: rows.length, valid: true };
}

/** Deterministic idempotency key for a post target (LBI-05). */
export function idemKey(
  modelId: string,
  bundleId: string,
  platform: string,
  slotIso: string,
): Buffer {
  return createHash('sha256')
    .update(`${modelId}|${bundleId}|${platform}|${slotIso}`)
    .digest();
}
