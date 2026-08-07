// ─── Fan CRM (F-05..F-08, L3.0) — contacts, timeline, custom requests ───
// fan_crm_contact + fan_touchpoint + custom_request, all org-scoped.

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, desc } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, writeAudit } from './helpers.js';
import { parseCursor, cursorLt, nextCursor } from '../contract.js';

const router = new Hono<AppBindings>();

const contactSchema = z.object({
  modelId: z.string().uuid(),
  platform: z.string().min(1).max(50),
  externalId: z.string().min(1).max(200),
  displayName: z.string().max(200).optional(),
  tier: z.enum(['whale', 'loyal', 'expired', 'new']).optional(),
  lifetimeValueUsd: z.number().nonnegative().optional(),
});

const touchpointSchema = z.object({
  fanId: z.string().uuid(),
  platform: z.string().min(1).max(50),
  kind: z.string().min(1).max(50),
  direction: z.enum(['inbound', 'outbound']).default('inbound'),
  content: z.string().max(4000).optional(),
});

const requestSchema = z.object({
  modelId: z.string().uuid(),
  fanId: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  priceUsd: z.number().nonnegative().optional(),
});

const statusSchema = z.object({
  status: z.enum(['pending', 'filming', 'editing', 'delivered']),
});

// GET /models/:id/fans — fan CRM contacts (keyset cursor, DESC by LTV)
router.get('/models/:modelId/fans', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const { modelId } = c.req.param();
  const tier = c.req.query('tier');
  const { limit, cursor } = parseCursor(c);

  const rows = await withOrgContext(orgId, (tx) => {
    const conds = [
      eq(schema.fanCrmContact.orgId, orgId),
      eq(schema.fanCrmContact.modelId, modelId),
      ...cursorLt(schema.fanCrmContact.lifetimeValueUsd, schema.fanCrmContact.id, cursor),
    ];
    if (tier) conds.push(eq(schema.fanCrmContact.tier, tier));
    return tx
      .select()
      .from(schema.fanCrmContact)
      .where(and(...conds))
      .limit(limit)
      .orderBy(desc(schema.fanCrmContact.lifetimeValueUsd), desc(schema.fanCrmContact.id));
  });
  const last = rows[rows.length - 1];
  return c.json({
    data: rows,
    meta: {
      total: rows.length,
      limit,
      next_cursor: nextCursor(last?.lifetimeValueUsd, last?.id, limit, rows.length),
    },
  });
});

// POST /models/:id/fans — upsert a fan contact
router.post('/models/:modelId/fans', zValidator('json', contactSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const { modelId } = c.req.param();
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  const saved = await withOrgContext(orgId, async (tx) => {
    const [row] = await tx
      .insert(schema.fanCrmContact)
      .values({
        orgId,
        modelId,
        platform: body.platform,
        externalId: body.externalId,
        displayName: body.displayName ?? null,
        tier: body.tier ?? 'new',
        lifetimeValueUsd: body.lifetimeValueUsd != null ? String(body.lifetimeValueUsd) : '0',
        lastActiveAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.fanCrmContact.orgId, schema.fanCrmContact.modelId, schema.fanCrmContact.platform, schema.fanCrmContact.externalId],
        set: {
          displayName: body.displayName ?? undefined,
          tier: body.tier ?? undefined,
          lifetimeValueUsd: body.lifetimeValueUsd != null ? String(body.lifetimeValueUsd) : undefined,
          lastActiveAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();
    await writeAudit(tx, orgId, userId, 'fan.upsert', row.id, { platform: body.platform });
    return row;
  });
  return c.json({ data: saved }, 201);
});

// GET /fans/:id — unified timeline (F-07)
router.get('/fans/:fanId', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const { fanId } = c.req.param();

  const data = await withOrgContext(orgId, async (tx) => {
    const fans = await tx
      .select()
      .from(schema.fanCrmContact)
      .where(and(eq(schema.fanCrmContact.id, fanId), eq(schema.fanCrmContact.orgId, orgId)))
      .limit(1);
    if (fans.length === 0) return null;
    const touchpoints = await tx
      .select()
      .from(schema.fanTouchpoint)
      .where(eq(schema.fanTouchpoint.fanId, fanId))
      .orderBy(desc(schema.fanTouchpoint.ts))
      .limit(100);
    const requests = await tx
      .select()
      .from(schema.customRequest)
      .where(eq(schema.customRequest.fanId, fanId))
      .orderBy(desc(schema.customRequest.createdAt));
    return { fan: fans[0], touchpoints, requests };
  });
  if (!data) return c.json({ error: { message: 'fan not found' } }, 404);
  return c.json({ data });
});

// POST /fans/:fanId/touchpoints — record a timeline entry
router.post('/fans/:fanId/touchpoints', zValidator('json', touchpointSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const { fanId } = c.req.param();
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  const saved = await withOrgContext(orgId, async (tx) => {
    const [row] = await tx
      .insert(schema.fanTouchpoint)
      .values({
        orgId,
        fanId,
        platform: body.platform,
        kind: body.kind,
        direction: body.direction,
        content: body.content ?? null,
        ts: new Date(),
      })
      .returning();
    await writeAudit(tx, orgId, userId, 'fan.touchpoint', fanId, { kind: body.kind });
    return row;
  });
  return c.json({ data: saved }, 201);
});

// POST /custom-requests — ticket (F-08)
router.post('/custom-requests', zValidator('json', requestSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  const saved = await withOrgContext(orgId, async (tx) => {
    const [row] = await tx
      .insert(schema.customRequest)
      .values({
        orgId,
        modelId: body.modelId,
        fanId: body.fanId ?? null,
        title: body.title,
        description: body.description ?? null,
        status: 'pending',
        priceUsd: body.priceUsd != null ? String(body.priceUsd) : null,
      })
      .returning();
    await writeAudit(tx, orgId, userId, 'custom_request.create', row.id, { title: body.title });
    return row;
  });
  return c.json({ data: saved }, 201);
});

// PATCH /custom-requests/:id — status transition
router.patch('/custom-requests/:id', zValidator('json', statusSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const { id } = c.req.param();
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  const updated = await withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .update(schema.customRequest)
      .set({ status: body.status, updatedAt: new Date() })
      .where(and(eq(schema.customRequest.id, id), eq(schema.customRequest.orgId, orgId)))
      .returning();
    if (rows.length > 0) {
      await writeAudit(tx, orgId, userId, 'custom_request.status', id, { status: body.status });
    }
    return rows;
  });
  if (updated.length === 0) return c.json({ error: { message: 'request not found' } }, 404);
  return c.json({ data: updated[0] });
});

// GET /models/:id/custom-requests — list tickets for a model
router.get('/models/:modelId/custom-requests', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const { modelId } = c.req.param();

  const rows = await withOrgContext(orgId, (tx) =>
    tx
      .select()
      .from(schema.customRequest)
      .where(and(eq(schema.customRequest.orgId, orgId), eq(schema.customRequest.modelId, modelId)))
      .orderBy(desc(schema.customRequest.createdAt)),
  );
  return c.json({ data: rows, meta: { total: rows.length } });
});

export { router as fansRouter };
