// ─── Content bundles (F-36/F-37, L3.0) — real DB CRUD + lifecycle ───
// state machine: generated → approved → scheduled → publishing → published
// approve/revise/reject transitions are audited (LBI-08) and ToS-gated
// (LBI-11: a block verdict prevents approval).

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql, eq, and } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, writeAudit } from './helpers.js';

const router = new Hono<AppBindings>();

const createBundleSchema = z.object({
  modelId: z.string().uuid(),
  captions: z.record(z.string(), z.string()).default({}),
  hashtags: z.array(z.string()).default([]),
  tosReport: z.record(z.string(), z.unknown()).optional(),
});

const approveBundleSchema = z.object({
  platforms: z.array(z.string().min(1)).min(1),
  slot: z.string().datetime().optional(),
});

const reviseBundleSchema = z.object({
  instructions: z.string().min(1).max(2000),
});

// GET /api/v1/bundles/:id — bundle detail + variants + ToS scores
router.get('/:id', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const { id } = c.req.param();

  const rows = await withOrgContext(orgId, (tx) =>
    tx
      .select()
      .from(schema.contentBundle)
      .where(and(eq(schema.contentBundle.id, id), eq(schema.contentBundle.orgId, orgId)))
      .limit(1),
  );
  if (rows.length === 0) return c.json({ error: { message: 'bundle not found' } }, 404);
  return c.json({ data: rows[0] });
});

// POST /api/v1/bundles — create a generated bundle (from generator pipeline)
router.post('/', zValidator('json', createBundleSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  const inserted = await withOrgContext(orgId, async (tx) => {
    const [row] = await tx
      .insert(schema.contentBundle)
      .values({
        orgId,
        modelId: body.modelId,
        captions: body.captions,
        hashtags: body.hashtags,
        tosReport: body.tosReport ?? null,
        state: 'generated',
      })
      .returning();
    await writeAudit(tx, orgId, userId, 'bundle.create', row.id, {
      modelId: body.modelId,
      state: 'generated',
    });
    return row;
  });
  return c.json({ data: inserted }, 201);
});

// POST /api/v1/bundles/:id/approve — ToS-gated approval (LBI-11)
router.post('/:id/approve', zValidator('json', approveBundleSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const { id } = c.req.param();
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  const result = await withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.contentBundle)
      .where(and(eq(schema.contentBundle.id, id), eq(schema.contentBundle.orgId, orgId)))
      .limit(1);
    if (rows.length === 0) return { status: 404 as const, data: null };
    const bundle = rows[0];

    // ToS gate: a block verdict cannot be approved (LBI-11)
    const tos = (bundle.tosReport ?? {}) as {
      verdict?: string;
      scores?: Array<{ platform: string; verdict: string }>;
    };
    if (tos.verdict === 'block') {
      return { status: 409 as const, data: { error: { message: 'ToS block: bundle cannot be approved' } } };
    }
    for (const platform of body.platforms) {
      const score = (tos.scores ?? []).find((s) => s.platform === platform);
      if (score?.verdict === 'block') {
        return {
          status: 409 as const,
          data: { error: { message: `ToS block on ${platform}: bundle cannot be approved for this platform` } },
        };
      }
    }

    // Create post_targets (per-platform), transition bundle → approved
    const slot = body.slot ? new Date(body.slot) : new Date(Date.now() + 3600_000);
    for (const platform of body.platforms) {
      await tx.insert(schema.postTarget).values({
        orgId,
        bundleId: id,
        platform,
        scheduledFor: slot,
        state: 'pending',
        remoteId: null,
        error: null,
        idemKey: Buffer.from(`${id}|${platform}|${slot.toISOString()}`),
      });
    }
    const [updated] = await tx
      .update(schema.contentBundle)
      .set({ state: 'approved', updatedAt: new Date() })
      .where(eq(schema.contentBundle.id, id))
      .returning();
    await writeAudit(tx, orgId, userId, 'bundle.approve', id, {
      platforms: body.platforms,
      slot: slot.toISOString(),
    });
    return { status: 200 as const, data: updated };
  });

  if (result.status === 404) return c.json({ error: { message: 'bundle not found' } }, 404);
  if (result.status === 409) return c.json(result.data, 409);
  return c.json({ data: result.data });
});

// POST /api/v1/bundles/:id/revise — return to generated with instructions
router.post('/:id/revise', zValidator('json', reviseBundleSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const { id } = c.req.param();
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  const result = await withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .update(schema.contentBundle)
      .set({ state: 'generated', updatedAt: new Date() })
      .where(and(eq(schema.contentBundle.id, id), eq(schema.contentBundle.orgId, orgId)))
      .returning();
    if (rows.length === 0) return { status: 404 as const, data: null };
    await writeAudit(tx, orgId, userId, 'bundle.revise', id, {
      instructions: body.instructions,
    });
    return { status: 200 as const, data: rows[0] };
  });
  if (result.status === 404) return c.json({ error: { message: 'bundle not found' } }, 404);
  return c.json({ data: result.data });
});

// POST /api/v1/bundles/:id/reject
router.post('/:id/reject', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const { id } = c.req.param();
  const userId = c.get('userId') ?? 'system';

  const result = await withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .update(schema.contentBundle)
      .set({ state: 'rejected', updatedAt: new Date() })
      .where(and(eq(schema.contentBundle.id, id), eq(schema.contentBundle.orgId, orgId)))
      .returning();
    if (rows.length === 0) return { status: 404 as const, data: null };
    await writeAudit(tx, orgId, userId, 'bundle.reject', id, {});
    return { status: 200 as const, data: rows[0] };
  });
  if (result.status === 404) return c.json({ error: { message: 'bundle not found' } }, 404);
  return c.json({ data: result.data });
});

// GET /api/v1/bundles — list bundles for a model (dashboard approvals tab)
router.get('/', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const modelId = c.req.query('modelId');
  const state = c.req.query('state');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10) || 50, 200);

  const rows = await withOrgContext(orgId, (tx) => {
    const conds = [eq(schema.contentBundle.orgId, orgId)];
    if (modelId) conds.push(eq(schema.contentBundle.modelId, modelId));
    if (state) conds.push(eq(schema.contentBundle.state, state));
    return tx
      .select()
      .from(schema.contentBundle)
      .where(and(...conds))
      .limit(limit)
      .orderBy(sql`${schema.contentBundle.createdAt} DESC`);
  });
  return c.json({ data: rows, meta: { total: rows.length } });
});

export { router as bundlesRouter };
