// ─── Per-model network & egress (F-02, F-04, L3.0) — real DB + plane proxy ───
// GET/PUT /models/:id/network — egress config from model_network_configs
// GET /models/:id/network/health — live health via the egress plane

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, writeAudit, apiError, statusTitle } from './helpers.js';

const router = new Hono<AppBindings>();

const EGRESS_PLANE_URL = process.env.EGRESS_PLANE_URL ?? 'http://127.0.0.1:3000';

const networkSchema = z.object({
  egressMode: z.enum(['direct', 'socks5', 'http', 'https', 'wireguard', 'vpn']).default('direct'),
  proxyType: z.string().max(20).optional(),
  proxyAddr: z.string().max(500).optional(),
  wgPublicKey: z.string().max(200).optional(),
  wgEndpoint: z.string().max(500).optional(),
  wgAllowedIps: z.string().max(1000).optional(),
  wgPersistentKeepalive: z.number().int().min(0).max(65535).optional(),
  expectedEgressIp: z.string().max(100).optional(),
  failoverProxyAddrs: z.array(z.string().max(500)).optional(),
  proxyUsername: z.string().max(500).optional(),
  proxyPassword: z.string().max(500).optional(),
});

// GET /models/:id/network — egress config + health
router.get('/:modelId/network', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();

  const rows = await withOrgContext(orgId, (tx) =>
    tx
      .select()
      .from(schema.modelNetworkConfigs)
      .where(
        and(
          eq(schema.modelNetworkConfigs.orgId, orgId),
          eq(schema.modelNetworkConfigs.modelId, modelId),
        ),
      )
      .limit(1),
  );
  if (rows.length === 0) {
    return c.json({
      data: {
        modelId,
        egressMode: 'direct',
        healthy: false,
        lastCheck: null,
        latencyMs: null,
        lastEgressIp: null,
        failCount: 0,
        lastError: 'no egress config — direct default',
      },
    });
  }
  const row = rows[0];
  return c.json({
    data: {
      id: row.id,
      modelId: row.modelId,
      egressMode: row.egressMode,
      proxyType: row.proxyType,
      proxyAddr: row.proxyAddr,
      wgPublicKey: row.wgPublicKey,
      wgEndpoint: row.wgEndpoint,
      wgAllowedIps: row.wgAllowedIps,
      wgPersistentKeepalive: row.wgPersistentKeepalive,
      expectedEgressIp: row.expectedEgressIp,
      failoverProxyAddrs: row.failoverProxyAddrs,
      healthy: row.healthy,
      lastCheck: row.lastCheck,
      latencyMs: row.latencyMs,
      lastEgressIp: row.lastEgressIp,
      failCount: row.failCount,
      lastError: row.lastError,
    },
  });
});

// PUT /models/:id/network — set egress config (dashboard-only fields, L2.11)
router.put('/:modelId/network', zValidator('json', networkSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  const saved = await withOrgContext(orgId, async (tx) => {
    const existing = await tx
      .select({ id: schema.modelNetworkConfigs.id })
      .from(schema.modelNetworkConfigs)
      .where(
        and(
          eq(schema.modelNetworkConfigs.orgId, orgId),
          eq(schema.modelNetworkConfigs.modelId, modelId),
        ),
      )
      .limit(1);

    let row;
    if (existing.length > 0) {
      [row] = await tx
        .update(schema.modelNetworkConfigs)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(schema.modelNetworkConfigs.id, existing[0].id))
        .returning();
    } else {
      [row] = await tx
        .insert(schema.modelNetworkConfigs)
        .values({ orgId, modelId, ...body })
        .returning();
    }
    await writeAudit(tx, orgId, userId, 'network.update', modelId, {
      egressMode: body.egressMode,
      proxyAddr: body.proxyAddr ?? null,
      expectedEgressIp: body.expectedEgressIp ?? null,
    });
    return row;
  });
  return c.json({ data: saved });
});

// GET /models/:id/network/health — live health via the egress plane
router.get('/:modelId/network/health', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();

  const rows = await withOrgContext(orgId, (tx) =>
    tx
      .select()
      .from(schema.modelNetworkConfigs)
      .where(
        and(
          eq(schema.modelNetworkConfigs.orgId, orgId),
          eq(schema.modelNetworkConfigs.modelId, modelId),
        ),
      )
      .limit(1),
  );

  // The plane exposes one global status resource. Only query it for a model
  // with a config visible to this org, then select that model from the
  // response so another tenant's live egress state cannot be disclosed.
  let live: Record<string, unknown> | null = null;
  if (rows.length > 0) {
    try {
      const res = await fetch(`${EGRESS_PLANE_URL}/egress/status`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const status = (await res.json()) as { models?: unknown };
        if (Array.isArray(status.models)) {
          const model = status.models.find(
            (entry: unknown): entry is Record<string, unknown> =>
              typeof entry === 'object' &&
              entry !== null &&
              (entry as Record<string, unknown>).model_id === modelId,
          );
          live = model ?? null;
        }
      }
    } catch {
      live = null;
    }
  }

  const dbState = rows[0]
    ? {
        healthy: rows[0].healthy,
        lastCheck: rows[0].lastCheck,
        latencyMs: rows[0].latencyMs,
        lastEgressIp: rows[0].lastEgressIp,
        failCount: rows[0].failCount,
        lastError: rows[0].lastError,
      }
    : {
        healthy: false,
        lastCheck: null,
        latencyMs: null,
        lastEgressIp: null,
        failCount: 0,
        lastError: 'no config',
      };

  return c.json({ data: { modelId, live, db: dbState } });
});

export { router as networkRouter };
