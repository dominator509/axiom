// ─── Content bundles (F-36/F-37, L3.0) — real DB CRUD + lifecycle ───
// state machine: generated/hold → approved → scheduled → publishing → published
// approve/revise/reject transitions are audited (LBI-08) and ToS-gated
// (LBI-11: a block verdict prevents approval).

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql, eq, and } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import {
  withOrgContext,
  modelOrgId,
  requireOrg,
  writeAudit,
  apiError,
  statusTitle,
} from './helpers.js';
import { parseCursor, cursorLt, nextCursor } from '../contract.js';
import { asPlatform, enqueueJob, resolveCapabilities } from '@axiom/worker';
import type { Platform } from '@axiom/core';

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
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { id } = c.req.param();

  const rows = await withOrgContext(orgId, (tx) =>
    tx
      .select()
      .from(schema.contentBundle)
      .where(and(eq(schema.contentBundle.id, id), eq(schema.contentBundle.orgId, orgId)))
      .limit(1),
  );
  if (rows.length === 0) return apiError(c, 404, statusTitle(404), 'bundle not found');
  return c.json({ data: rows[0] });
});

// POST /api/v1/bundles — create a generated bundle (from generator pipeline)
router.post('/', zValidator('json', createBundleSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  const inserted = await withOrgContext(orgId, async (tx) => {
    if ((await modelOrgId(tx, body.modelId)) !== orgId) return null;
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
  if (!inserted) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: inserted }, 201);
});

// POST /api/v1/bundles/:id/approve — ToS-gated approval (LBI-11)
router.post('/:id/approve', zValidator('json', approveBundleSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { id } = c.req.param();
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  const platforms: Platform[] = [];
  const seenPlatforms = new Set<string>();
  for (const requestedPlatform of body.platforms) {
    let platform: Platform;
    try {
      platform = asPlatform(requestedPlatform);
    } catch {
      return apiError(
        c,
        400,
        statusTitle(400),
        `unsupported target platform '${requestedPlatform}'`,
      );
    }
    if (seenPlatforms.has(platform)) {
      return apiError(c, 400, statusTitle(400), `duplicate target platform '${platform}'`);
    }
    seenPlatforms.add(platform);
    platforms.push(platform);
  }

  const result = await withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.contentBundle)
      .where(and(eq(schema.contentBundle.id, id), eq(schema.contentBundle.orgId, orgId)))
      .limit(1);
    if (rows.length === 0) return { status: 404 as const, data: null };
    const bundle = rows[0];
    if (bundle.state !== 'generated' && bundle.state !== 'hold') {
      return {
        status: 409 as const,
        error: `bundle is already ${bundle.state}; only generated or held bundles can be approved`,
      };
    }

    // ToS gate: a block verdict cannot be approved (LBI-11)
    const tos = (bundle.tosReport ?? {}) as {
      verdict?: string;
      scores?: Array<{ platform: string; verdict: string }>;
    };
    if (tos.verdict === 'block') {
      return { status: 409 as const, error: 'ToS block: bundle cannot be approved' };
    }
    for (const platform of platforms) {
      const score = (tos.scores ?? []).find((s) => s.platform === platform);
      if (score?.verdict === 'block') {
        return {
          status: 409 as const,
          error: `ToS block on ${platform}: bundle cannot be approved for this platform`,
        };
      }
    }

    // Generation currently creates prompt/caption bundles; it does not
    // create an asset row. Do not enqueue a publish job that the connector
    // will inevitably reject for missing media. Text-capable connectors can
    // still be approved without an asset; all others fail before mutation.
    if (!bundle.assetId) {
      for (const platform of platforms) {
        try {
          if (resolveCapabilities(platform).media.includes('text')) continue;
        } catch {
          return {
            status: 409 as const,
            error: `cannot resolve ${platform} capabilities; media requirement is unknown`,
          };
        }
        return {
          status: 409 as const,
          error: `bundle has no media asset; ${platform} requires media before approval`,
        };
      }
    }

    // Create post_targets (per-platform), transition bundle → approved
    const slot = body.slot ? new Date(body.slot) : new Date(Date.now() + 3600_000);
    for (const platform of platforms) {
      const [target] = await tx
        .insert(schema.postTarget)
        .values({
          orgId,
          bundleId: id,
          platform,
          scheduledFor: slot,
          state: 'pending',
          remoteId: null,
          error: null,
          idemKey: Buffer.from(`${id}|${platform}|${slot.toISOString()}`),
        })
        .returning({ id: schema.postTarget.id });
      if (!target?.id) throw new Error(`bundle.approve: target insert returned no id`);

      // Approval is also the dashboard's scheduling action. Enqueue in the
      // same transaction as the target so a committed approval always has a
      // durable worker handoff, with duplicate taps collapsed by target ID.
      await enqueueJob(tx, {
        orgId,
        queue: 'publish',
        kind: 'publish.target',
        payload: { targetId: target.id },
        runAfter: slot,
        dedupeParts: ['publish.target', target.id],
      });
    }
    const [updated] = await tx
      .update(schema.contentBundle)
      .set({ state: 'approved', updatedAt: new Date() })
      .where(and(eq(schema.contentBundle.id, id), eq(schema.contentBundle.state, bundle.state)))
      .returning();
    if (updated.length === 0) {
      return {
        status: 409 as const,
        error: 'bundle changed while approval was being applied; retry the action',
      };
    }
    await writeAudit(tx, orgId, userId, 'bundle.approve', id, {
      platforms,
      slot: slot.toISOString(),
    });
    return { status: 200 as const, data: updated };
  });

  if (result.status === 404) return apiError(c, 404, statusTitle(404), 'bundle not found');
  if (result.status === 409) return apiError(c, 409, statusTitle(409), result.error ?? 'conflict');
  return c.json({ data: result.data });
});

// POST /api/v1/bundles/:id/revise — return to generated with instructions
router.post('/:id/revise', zValidator('json', reviseBundleSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { id } = c.req.param();
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  const result = await withOrgContext(orgId, async (tx) => {
    const current = await tx
      .select({ id: schema.contentBundle.id, state: schema.contentBundle.state })
      .from(schema.contentBundle)
      .where(and(eq(schema.contentBundle.id, id), eq(schema.contentBundle.orgId, orgId)))
      .limit(1);
    if (current.length === 0) return { status: 404 as const, data: null };
    if (current[0].state !== 'generated' && current[0].state !== 'hold') {
      return {
        status: 409 as const,
        error: `bundle is already ${current[0].state}; only generated or held bundles can be revised`,
      };
    }

    const rows = await tx
      .update(schema.contentBundle)
      .set({ state: 'generated', updatedAt: new Date() })
      .where(
        and(
          eq(schema.contentBundle.id, id),
          eq(schema.contentBundle.orgId, orgId),
          eq(schema.contentBundle.state, current[0].state),
        ),
      )
      .returning();
    if (rows.length === 0) {
      return {
        status: 409 as const,
        error: 'bundle changed while revision was being applied; retry the action',
      };
    }
    await writeAudit(tx, orgId, userId, 'bundle.revise', id, {
      instructions: body.instructions,
    });
    return { status: 200 as const, data: rows[0] };
  });
  if (result.status === 404) return apiError(c, 404, statusTitle(404), 'bundle not found');
  if (result.status === 409) return apiError(c, 409, statusTitle(409), result.error ?? 'conflict');
  return c.json({ data: result.data });
});

// POST /api/v1/bundles/:id/reject
router.post('/:id/reject', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { id } = c.req.param();
  const userId = c.get('userId') ?? 'system';

  const result = await withOrgContext(orgId, async (tx) => {
    const current = await tx
      .select({ id: schema.contentBundle.id, state: schema.contentBundle.state })
      .from(schema.contentBundle)
      .where(and(eq(schema.contentBundle.id, id), eq(schema.contentBundle.orgId, orgId)))
      .limit(1);
    if (current.length === 0) return { status: 404 as const, data: null };
    if (current[0].state !== 'generated' && current[0].state !== 'hold') {
      return {
        status: 409 as const,
        error: `bundle is already ${current[0].state}; only generated or held bundles can be rejected`,
      };
    }

    const rows = await tx
      .update(schema.contentBundle)
      .set({ state: 'rejected', updatedAt: new Date() })
      .where(
        and(
          eq(schema.contentBundle.id, id),
          eq(schema.contentBundle.orgId, orgId),
          eq(schema.contentBundle.state, current[0].state),
        ),
      )
      .returning();
    if (rows.length === 0) {
      return {
        status: 409 as const,
        error: 'bundle changed while rejection was being applied; retry the action',
      };
    }
    await writeAudit(tx, orgId, userId, 'bundle.reject', id, {});
    return { status: 200 as const, data: rows[0] };
  });
  if (result.status === 404) return apiError(c, 404, statusTitle(404), 'bundle not found');
  if (result.status === 409) return apiError(c, 409, statusTitle(409), result.error ?? 'conflict');
  return c.json({ data: result.data });
});

// GET /api/v1/bundles — list bundles for a model (dashboard approvals tab)
router.get('/', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const modelId = c.req.query('modelId');
  const state = c.req.query('state');
  const { limit, cursor } = parseCursor(c);

  const rows = await withOrgContext(orgId, (tx) => {
    const conds = [
      eq(schema.contentBundle.orgId, orgId),
      ...cursorLt(schema.contentBundle.createdAt, schema.contentBundle.id, cursor),
    ];
    if (modelId) conds.push(eq(schema.contentBundle.modelId, modelId));
    if (state) conds.push(eq(schema.contentBundle.state, state));
    return tx
      .select()
      .from(schema.contentBundle)
      .where(and(...conds))
      .limit(limit)
      .orderBy(sql`${schema.contentBundle.createdAt} DESC`, sql`${schema.contentBundle.id} DESC`);
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

export { router as bundlesRouter };
