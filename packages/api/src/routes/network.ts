// ─── Per-model network & egress (F-02, F-04, L3.0) — real DB + plane proxy ───
// GET/PUT /models/:id/network — egress config from model_network_configs
// GET /models/:id/network/health — live health via the egress plane

import { Hono } from 'hono';
import { z } from 'zod';
import { boundedJsonValidator as zValidator } from '../bounded-json-validator.js';
import { eq, and } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { DEFAULT_EGRESS_PLANE_URL, readBoundedResponseJson } from '@axiom/core';
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

const router = new Hono<AppBindings>();

const EGRESS_PLANE_URL = process.env.EGRESS_PLANE_URL ?? DEFAULT_EGRESS_PLANE_URL;
const EGRESS_PLANE_HEADERS: Record<string, string> = process.env.EGRESS_PLANE_TOKEN?.trim()
  ? { 'x-egress-plane-token': process.env.EGRESS_PLANE_TOKEN.trim() }
  : {};

const networkSchema = z
  .object({
    egressMode: z.enum(['direct', 'socks5', 'http', 'https', 'wireguard', 'vpn']).default('direct'),
    proxyType: z.string().max(20).optional(),
    proxyAddr: z.string().max(500).optional(),
    wgPublicKey: z.string().max(200).optional(),
    wgEndpoint: z.string().max(500).optional(),
    wgAllowedIps: z.string().max(1000).optional(),
    wgPersistentKeepalive: z.number().int().min(0).max(65535).optional(),
    expectedEgressIp: z.string().max(100).optional(),
    failoverProxyAddrs: z.array(z.string().max(500)).optional(),
  })
  .strict();

type NetworkConfigRow = InferSelectModel<typeof schema.modelNetworkConfigs>;
type PublicNetworkConfig = Pick<
  NetworkConfigRow,
  | 'id'
  | 'modelId'
  | 'egressMode'
  | 'proxyType'
  | 'proxyAddr'
  | 'wgPublicKey'
  | 'wgEndpoint'
  | 'wgAllowedIps'
  | 'wgPersistentKeepalive'
  | 'expectedEgressIp'
  | 'failoverProxyAddrs'
  | 'healthy'
  | 'lastCheck'
  | 'latencyMs'
  | 'lastEgressIp'
  | 'failCount'
  | 'lastError'
  | 'createdAt'
  | 'updatedAt'
>;

/** Return network metadata without exposing the encrypted credential envelope. */
function publicNetworkConfig(row: PublicNetworkConfig): PublicNetworkConfig {
  return {
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// GET /models/:id/network — egress config + health
router.get('/:modelId/network', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();

  const rows = await withOrgContext(orgId, (tx) =>
    tx
      .select({
        id: schema.modelNetworkConfigs.id,
        modelId: schema.modelNetworkConfigs.modelId,
        egressMode: schema.modelNetworkConfigs.egressMode,
        proxyType: schema.modelNetworkConfigs.proxyType,
        proxyAddr: schema.modelNetworkConfigs.proxyAddr,
        wgPublicKey: schema.modelNetworkConfigs.wgPublicKey,
        wgEndpoint: schema.modelNetworkConfigs.wgEndpoint,
        wgAllowedIps: schema.modelNetworkConfigs.wgAllowedIps,
        wgPersistentKeepalive: schema.modelNetworkConfigs.wgPersistentKeepalive,
        expectedEgressIp: schema.modelNetworkConfigs.expectedEgressIp,
        failoverProxyAddrs: schema.modelNetworkConfigs.failoverProxyAddrs,
        healthy: schema.modelNetworkConfigs.healthy,
        lastCheck: schema.modelNetworkConfigs.lastCheck,
        latencyMs: schema.modelNetworkConfigs.latencyMs,
        lastEgressIp: schema.modelNetworkConfigs.lastEgressIp,
        failCount: schema.modelNetworkConfigs.failCount,
        lastError: schema.modelNetworkConfigs.lastError,
        createdAt: schema.modelNetworkConfigs.createdAt,
        updatedAt: schema.modelNetworkConfigs.updatedAt,
      })
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
  return c.json({ data: publicNetworkConfig(rows[0]) });
});

// PUT /models/:id/network — set egress config (dashboard-only fields, L2.11)
router.put('/:modelId/network', zValidator('json', networkSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  const saved = await withOrgContext(orgId, async (tx) => {
    if ((await modelOrgId(tx, modelId)) !== orgId) return null;
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
        .where(
          and(
            eq(schema.modelNetworkConfigs.id, existing[0].id),
            eq(schema.modelNetworkConfigs.orgId, orgId),
          ),
        )
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
  if (!saved) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: publicNetworkConfig(saved) });
});

// GET /models/:id/network/health — live health via the egress plane
router.get('/:modelId/network/health', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();

  const rows = await withOrgContext(orgId, (tx) =>
    tx
      .select({
        modelId: schema.modelNetworkConfigs.modelId,
        healthy: schema.modelNetworkConfigs.healthy,
        lastCheck: schema.modelNetworkConfigs.lastCheck,
        latencyMs: schema.modelNetworkConfigs.latencyMs,
        lastEgressIp: schema.modelNetworkConfigs.lastEgressIp,
        failCount: schema.modelNetworkConfigs.failCount,
        lastError: schema.modelNetworkConfigs.lastError,
      })
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
        headers: EGRESS_PLANE_HEADERS,
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const status = await readBoundedResponseJson<{ models?: unknown }>(res);
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
