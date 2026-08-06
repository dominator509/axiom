// ─── Incidents & DLQ (F-73..F-78, L3.0) — real job-table reads + replay ───
// GET /incidents — failed/dead jobs + recent incident events
// POST /incidents/:jobId/replay — idempotent DLQ replay (reset → ready)

import { Hono } from 'hono';
import { sql, eq, and, desc } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, writeAudit } from './helpers.js';

const router = new Hono<AppBindings>();

// GET /incidents — dead/failed jobs (the durable DLQ view)
router.get('/incidents', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10) || 50, 200);

  const rows = await withOrgContext(orgId, (tx) =>
    tx
      .select()
      .from(schema.job)
      .where(
        and(
          eq(schema.job.orgId, orgId),
          sql`${schema.job.state} IN ('dead', 'failed') OR ${schema.job.attempts} >= ${schema.job.maxAttempts}`,
        ),
      )
      .orderBy(desc(schema.job.createdAt))
      .limit(limit),
  );
  return c.json({ data: rows, meta: { total: rows.length } });
});

// POST /incidents/:jobId/replay — reset a dead job back to ready (DLQ replay)
router.post('/incidents/:jobId/replay', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
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
  if (result.status === 404) return c.json({ error: { message: 'job not found' } }, 404);
  return c.json({ success: true, data: result.data });
});

export { router as incidentsRouter };
