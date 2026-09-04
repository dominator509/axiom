// ─── Incidents & DLQ (F-73..F-78, L3.0) — real job-table reads + replay ───
// GET /incidents — failed/dead jobs + recent incident events
// POST /incidents/:jobId/replay — idempotent DLQ replay (reset → ready)

import { Hono } from 'hono';
import { sql, eq, and, desc } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, writeAudit, apiError, statusTitle } from './helpers.js';
import { parseCursor, cursorLt, nextCursor } from '../contract.js';

const router = new Hono<AppBindings>();

// GET /incidents — dead/failed jobs (the durable DLQ view)
router.get('/incidents', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { limit, cursor } = parseCursor(c);

  const rows = await withOrgContext(orgId, (tx) => {
    const conds = [
      eq(schema.job.orgId, orgId),
      sql`${schema.job.state} IN ('dead', 'failed') OR ${schema.job.attempts} >= ${schema.job.maxAttempts}`,
      ...cursorLt(schema.job.createdAt, schema.job.id, cursor),
    ];
    return tx
      .select()
      .from(schema.job)
      .where(and(...conds))
      .orderBy(desc(schema.job.createdAt), desc(schema.job.id))
      .limit(limit);
  });
  const last = rows[rows.length - 1];
  return c.json({
    data: rows,
    meta: {
      total: rows.length,
      limit,
      next_cursor: nextCursor(last?.createdAt, last?.id, limit, rows.length),
    },
  });
});

// POST /incidents/:jobId/replay — reset a dead job back to ready (DLQ replay).
// The mounted API middleware supplies durable request replay protection.
router.post('/incidents/:jobId/replay', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { jobId } = c.req.param();
  const userId = c.get('userId') ?? 'system';

  const result = await withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .update(schema.job)
      .set({
        state: 'ready',
        attempts: 0,
        lastError: null,
        startedAt: null,
        completedAt: null,
      })
      .where(and(eq(schema.job.id, jobId), eq(schema.job.orgId, orgId)))
      .returning();
    if (rows.length === 0) return { status: 404 as const, data: null };
    await writeAudit(tx, orgId, userId, 'incident.replay', jobId, {});
    return { status: 200 as const, data: rows[0] };
  });
  if (result.status === 404) return apiError(c, 404, statusTitle(404), 'job not found');
  return c.json({ success: true, data: result.data });
});

export { router as incidentsRouter };
