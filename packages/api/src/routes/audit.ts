// ─── Audit log (LBI-08, L3.0) — hash-chain read + verify ───
// GET /audit — org's audit trail, newest first
// GET /audit/verify — verify the chain integrity (tamper detection)

import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, verifyAuditChain } from './helpers.js';

const router = new Hono<AppBindings>();

// GET /audit?limit=100 — recent audit entries
router.get('/audit', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10) || 100, 500);
  const action = c.req.query('action');

  const rows = await withOrgContext(orgId, (tx) => {
    const base = tx
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.orgId, orgId));
    if (action) base.where(eq(schema.auditLog.action, action));
    return base.orderBy(desc(schema.auditLog.ts)).limit(limit);
  });
  return c.json({ data: rows, meta: { total: rows.length } });
});

// GET /audit/verify — verify hash chain (LBI-08)
router.get('/audit/verify', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const result = await withOrgContext(orgId, (tx) => verifyAuditChain(tx, orgId));
  return c.json({ data: result });
});

export { router as auditRouter };
