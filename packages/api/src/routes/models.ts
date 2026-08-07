// ─── Model profiles (F-01) — real DB CRUD, org-scoped via RLS ───
// Replaces the previous stub. Every query runs inside withOrgContext so
// Postgres RLS (app.current_org_id) scopes results to the session's org.

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql, eq, and } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, writeAudit } from './helpers.js';
import { parseCursor, cursorGt, nextCursor } from '../contract.js';

const router = new Hono<AppBindings>();

const createModelSchema = z.object({
  displayName: z.string().min(1).max(100),
  handle: z.string().min(1).max(50),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().optional(),
});

const updateModelSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  handle: z.string().min(1).max(50).optional(),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().optional(),
  isActive: z.boolean().optional(),
});

// GET /api/v1/models — list models scoped to the session org (keyset cursor)
router.get('/', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);

  const { limit, cursor } = parseCursor(c);

  const rows = await withOrgContext(orgId, (tx) => {
    const conds = [
      eq(schema.modelProfile.orgId, orgId),
      ...cursorGt(schema.modelProfile.createdAt, schema.modelProfile.id, cursor),
    ];
    return tx
      .select()
      .from(schema.modelProfile)
      .where(and(...conds))
      .limit(limit)
      .orderBy(schema.modelProfile.createdAt, schema.modelProfile.id);
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

// GET /api/v1/models/stats/count — count models for the org (dashboard overview)
// Registered before /:id so the static segment wins.
router.get('/stats/count', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const rows = await withOrgContext(orgId, (tx) =>
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.modelProfile)
      .where(eq(schema.modelProfile.orgId, orgId)),
  );
  return c.json({ data: { count: rows[0]?.count ?? 0 } });
});

// GET /api/v1/models/:id — model detail
router.get('/:id', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const { id } = c.req.param();

  const rows = await withOrgContext(orgId, (tx) =>
    tx
      .select()
      .from(schema.modelProfile)
      .where(and(eq(schema.modelProfile.id, id), eq(schema.modelProfile.orgId, orgId)))
      .limit(1),
  );
  if (rows.length === 0) return c.json({ error: { message: 'model not found' } }, 404);
  return c.json({ data: rows[0] });
});

// POST /api/v1/models — create model
router.post('/', zValidator('json', createModelSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  const inserted = await withOrgContext(orgId, async (tx) => {
    const [row] = await tx
      .insert(schema.modelProfile)
      .values({
        orgId,
        displayName: body.displayName,
        handle: body.handle,
        bio: body.bio ?? null,
        avatarUrl: body.avatarUrl ?? null,
        isActive: true,
      })
      .returning();
    await writeAudit(tx, orgId, userId, 'model.create', row.id, {
      displayName: body.displayName,
      handle: body.handle,
    });
    return row;
  });
  return c.json({ data: inserted }, 201);
});

// PATCH /api/v1/models/:id — update model
router.patch('/:id', zValidator('json', updateModelSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const { id } = c.req.param();
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  const updated = await withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .update(schema.modelProfile)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(schema.modelProfile.id, id), eq(schema.modelProfile.orgId, orgId)))
      .returning();
    if (rows.length > 0) {
      await writeAudit(tx, orgId, userId, 'model.update', id, { changes: body });
    }
    return rows;
  });
  if (updated.length === 0) return c.json({ error: { message: 'model not found' } }, 404);
  return c.json({ data: updated[0] });
});

// DELETE /api/v1/models/:id — soft delete (is_active = false)
router.delete('/:id', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const { id } = c.req.param();
  const userId = c.get('userId') ?? 'system';

  const updated = await withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .update(schema.modelProfile)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(schema.modelProfile.id, id), eq(schema.modelProfile.orgId, orgId)))
      .returning();
    if (rows.length > 0) {
      await writeAudit(tx, orgId, userId, 'model.delete', id, { soft: true });
    }
    return rows;
  });
  if (updated.length === 0) return c.json({ error: { message: 'model not found' } }, 404);
  return c.json({ success: true, data: updated[0] });
});

export { router as modelsRouter };
