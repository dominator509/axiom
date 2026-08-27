// ─── Link-in-bio — native provider CRUD + first-party analytics ────────────
// External provider adapters are not implemented yet. Keep them out of the
// production route until provisioning, OAuth, token revocation, and analytics
// ingestion exist; never represent a database label as an active integration.

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql, eq, and, desc } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, writeAudit, apiError, statusTitle } from './helpers.js';

const router = new Hono<AppBindings>();

const PROVIDER_KINDS = ['native'] as const;

const enableSchema = z.object({
  kind: z.enum(PROVIDER_KINDS),
  config: z.record(z.string(), z.unknown()).default({}),
  isPrimary: z.boolean().optional(),
});

// GET /models/:id/linkbio — active providers + primary
router.get('/models/:modelId/linkbio', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();

  const rows = await withOrgContext(orgId, (tx) =>
    tx
      .select()
      .from(schema.linkbioProvider)
      .where(
        and(
          eq(schema.linkbioProvider.orgId, orgId),
          eq(schema.linkbioProvider.modelId, modelId),
          eq(schema.linkbioProvider.kind, 'native'),
        ),
      )
      .orderBy(schema.linkbioProvider.createdAt),
  );
  return c.json({
    data: {
      providers: rows,
      primary: rows.find((r: { isPrimary?: boolean | null }) => r.isPrimary) ?? rows[0] ?? null,
      nativeEnabled: rows.some(
        (r: { kind?: string | null; enabled?: boolean | null }) => r.kind === 'native' && r.enabled,
      ),
    },
  });
});

// POST /models/:id/linkbio — enable provider {kind, config}
router.post('/models/:modelId/linkbio', zValidator('json', enableSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  const saved = await withOrgContext(orgId, async (tx) => {
    const [row] = await tx
      .insert(schema.linkbioProvider)
      .values({
        orgId,
        modelId,
        kind: body.kind,
        enabled: true,
        isPrimary: body.isPrimary ?? false,
        config: body.config,
      })
      .onConflictDoUpdate({
        target: [
          schema.linkbioProvider.orgId,
          schema.linkbioProvider.modelId,
          schema.linkbioProvider.kind,
        ],
        set: { enabled: true, config: body.config, updatedAt: new Date() },
      })
      .returning();
    await writeAudit(tx, orgId, userId, 'linkbio.enable', modelId, { kind: body.kind });
    return row;
  });
  return c.json({ data: saved }, 201);
});

// DELETE /models/:id/linkbio/:kind — disable provider
router.delete('/models/:modelId/linkbio/:kind', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId, kind } = c.req.param();
  if (!PROVIDER_KINDS.includes(kind as (typeof PROVIDER_KINDS)[number])) {
    return apiError(c, 400, statusTitle(400), 'unknown provider kind');
  }
  const userId = c.get('userId') ?? 'system';

  const updated = await withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .update(schema.linkbioProvider)
      .set({ enabled: false, isPrimary: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.linkbioProvider.orgId, orgId),
          eq(schema.linkbioProvider.modelId, modelId),
          eq(schema.linkbioProvider.kind, kind),
        ),
      )
      .returning();
    if (rows.length > 0) {
      await writeAudit(tx, orgId, userId, 'linkbio.disable', modelId, { kind });
    }
    return rows;
  });
  if (updated.length === 0) return apiError(c, 404, statusTitle(404), 'provider not enabled');
  return c.json({ data: updated[0] });
});

// GET /models/:id/linkbio/analytics — normalized cross-provider analytics (F-53)
router.get('/models/:modelId/linkbio/analytics', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();

  const data = await withOrgContext(orgId, async (tx) => {
    const providers = await tx
      .select()
      .from(schema.linkbioProvider)
      .where(
        and(
          eq(schema.linkbioProvider.orgId, orgId),
          eq(schema.linkbioProvider.modelId, modelId),
          eq(schema.linkbioProvider.kind, 'native'),
        ),
      );

    const providerIds = providers.map((p: { id: string }) => p.id);
    let clicks: Array<{ providerId: string; target: string; count: number }> = [];
    if (providerIds.length > 0) {
      clicks = await tx
        .select({
          providerId: schema.linkbioClick.providerId,
          target: schema.linkbioClick.target,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.linkbioClick)
        .where(
          sql`${schema.linkbioClick.providerId} IN (${providerIds.map((id: string) => sql`${id}`).join(', ')})`,
        )
        .groupBy(schema.linkbioClick.providerId, schema.linkbioClick.target)
        .orderBy(desc(sql`count(*)`));
    }

    const total = clicks.reduce((acc, c) => acc + c.count, 0);
    return {
      providers: providers.map(
        (p: { id: string; kind: string; enabled: boolean; isPrimary?: boolean | null }) => ({
          id: p.id,
          kind: p.kind,
          enabled: p.enabled,
          isPrimary: p.isPrimary,
          clicks: clicks.filter((c) => c.providerId === p.id).reduce((acc, c) => acc + c.count, 0),
        }),
      ),
      totalClicks: total,
      topTargets: clicks.slice(0, 10),
    };
  });
  return c.json({ data });
});

// POST /linkbio/clicks — record a click (used by the served native page)
router.post(
  '/linkbio/clicks',
  zValidator(
    'json',
    z.object({
      providerId: z.string().uuid(),
      target: z.string().min(1),
      source: z.string().optional(),
    }),
  ),
  async (c) => {
    const orgId = requireOrg(c);
    if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
    const body = c.req.valid('json');

    await withOrgContext(orgId, (tx) =>
      tx.insert(schema.linkbioClick).values({
        orgId,
        providerId: body.providerId,
        target: body.target,
        source: body.source ?? null,
        ts: new Date(),
      }),
    );
    return c.json({ success: true });
  },
);

export { router as linkbioRouter };
