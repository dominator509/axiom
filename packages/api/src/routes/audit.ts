// ─── Audit log (LBI-08, L3.0) — hash-chain read + verify ───
// GET /audit — org's audit trail, newest first
// GET /audit/verify — verify the chain integrity (tamper detection)

import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, verifyAuditChain, apiError, statusTitle } from './helpers.js';
import { parseCursor, cursorLt, nextCursor } from '../contract.js';

const router = new Hono<AppBindings>();

// GET /audit?limit=100 — recent audit entries (keyset cursor, DESC by ts)
router.get('/audit', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { limit, cursor } = parseCursor(c, 100, 500);
  const action = c.req.query('action');

  const rows = await withOrgContext(orgId, (tx) => {
    const conds = [
      eq(schema.auditLog.orgId, orgId),
      ...cursorLt(schema.auditLog.ts, schema.auditLog.id, cursor),
    ];
    if (action) conds.push(eq(schema.auditLog.action, action));
    return tx
      .select()
      .from(schema.auditLog)
      .where(and(...conds))
      .orderBy(desc(schema.auditLog.ts), desc(schema.auditLog.id))
      .limit(limit);
  });
  const last = rows[rows.length - 1];
  return c.json({
    data: rows,
    meta: {
      total: rows.length,
      limit,
      next_cursor: nextCursor(last?.ts, last?.id, limit, rows.length),
    },
  });
});

// GET /audit/verify — verify hash chain (LBI-08)
router.get('/audit/verify', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const result = await withOrgContext(orgId, (tx) => verifyAuditChain(tx, orgId));
  return c.json({ data: result });
});

export { router as auditRouter };
