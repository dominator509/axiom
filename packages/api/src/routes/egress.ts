// ─── Egress config management (L2.6) — Vitest-backed API routes ───
// Real DB-backed CRUD for model_network_configs (org-scoped via RLS
// app.current_org_id) + proxy endpoints to the egress-plane (:3000) for
// bind/unbind/status/sync. Credentials never enter the API process in
// plaintext: the API calls the plane's /egress/encrypt to get an envelope
// and stores enc_creds/enc_nonce/dek_id.

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { apiError, modelOrgId, statusTitle } from './helpers.js';

const router = new Hono<AppBindings>();

const EGRESS_PLANE_URL = process.env.EGRESS_PLANE_URL ?? 'http://127.0.0.1:3000';
const EGRESS_MODES = ['direct', 'socks5', 'http', 'https', 'wireguard', 'vpn'] as const;
const EGRESS_DEK_ID = process.env.EGRESS_DEK_ID ?? 'egress-dek';

const createEgressConfigSchema = z.object({
  modelId: z.string().uuid(),
  egressMode: z.enum(EGRESS_MODES).default('direct'),
  proxyType: z.string().max(20).optional(),
  proxyAddr: z.string().max(500).optional(),
  wgPublicKey: z.string().max(200).optional(),
  wgEndpoint: z.string().max(500).optional(),
  wgAllowedIps: z.string().max(1000).optional(),
  wgPersistentKeepalive: z.number().int().min(0).max(65535).optional(),
  expectedEgressIp: z.string().max(100).optional(),
  failoverProxyAddrs: z.array(z.string().max(500)).optional(),
  // Plaintext credential fields — accepted for create/update, encrypted via
  // the plane's /egress/encrypt BEFORE the row is written. Never stored raw.
  proxyUsername: z.string().max(500).optional(),
  proxyPassword: z.string().max(500).optional(),
  wgPrivateKey: z.string().max(500).optional(),
  wgPresharedKey: z.string().max(500).optional(),
  vpnConfig: z.string().max(20000).optional(),
});

const updateEgressConfigSchema = createEgressConfigSchema.partial();

/** Set the RLS org context for a transaction-scoped query set. */
async function withOrgContext<T>(orgId: string, fn: (tx: any) => Promise<T> | T): Promise<T> {
  return db.transaction<T>(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    return await fn(tx);
  });
}

/** Ask the egress plane to envelope-encrypt credential plaintext. */
async function encryptCreds(
  plaintext: string,
): Promise<{ encCreds: Uint8Array; encNonce: Uint8Array; dekId: string } | null> {
  try {
    const res = await fetch(`${EGRESS_PLANE_URL}/egress/encrypt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        plaintext: Buffer.from(plaintext, 'utf8').toString('base64'),
        dek_id: EGRESS_DEK_ID,
      }),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      enc_creds?: string;
      enc_nonce?: string;
      dek_id?: string;
    };
    if (!body.enc_creds || !body.enc_nonce) return null;
    return {
      encCreds: new Uint8Array(Buffer.from(body.enc_creds, 'base64')),
      encNonce: new Uint8Array(Buffer.from(body.enc_nonce, 'base64')),
      dekId: body.dek_id ?? EGRESS_DEK_ID,
    };
  } catch {
    return null;
  }
}

/** Build the credential JSON payload for a config create/update. */
function credsPayload(body: Record<string, unknown>): string | null {
  const fieldNames = {
    proxyUsername: 'proxy_username',
    proxyPassword: 'proxy_password',
    wgPrivateKey: 'wg_private_key',
    wgPresharedKey: 'wg_preshared_key',
    vpnConfig: 'vpn_config',
  } as const;
  const credentials: Record<string, string> = {};
  for (const [inputName, outputName] of Object.entries(fieldNames)) {
    const value = body[inputName];
    if (typeof value === 'string' && value.length > 0) credentials[outputName] = value;
  }
  if (Object.keys(credentials).length === 0) return null;
  // JSON.stringify handles backslashes, control characters, and quotes in
  // proxy/WireGuard credentials. Hand-built JSON cannot safely encode them.
  return JSON.stringify(credentials);
}

function sanitizeConfig(row: any) {
  const { encCreds, encNonce, dekId, ...safe } = row;
  return safe;
}

// List configs for the current org
router.get('/', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  try {
    const rows = await withOrgContext(orgId, (tx) =>
      tx
        .select()
        .from(schema.modelNetworkConfigs)
        .where(eq(schema.modelNetworkConfigs.orgId, orgId)),
    );
    return c.json({ data: rows.map(sanitizeConfig), meta: { total: rows.length } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return apiError(c, 500, statusTitle(500), `egress config list failed: ${msg}`);
  }
});

// Get a single config
router.get('/:id', async (c) => {
  const orgId = c.get('orgId');
  const { id } = c.req.param();
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  try {
    const rows = await withOrgContext(orgId, (tx) =>
      tx
        .select()
        .from(schema.modelNetworkConfigs)
        .where(
          and(eq(schema.modelNetworkConfigs.id, id), eq(schema.modelNetworkConfigs.orgId, orgId)),
        )
        .limit(1),
    );
    if (rows.length === 0) return apiError(c, 404, statusTitle(404), 'config not found');
    return c.json({ data: sanitizeConfig(rows[0]) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return apiError(c, 500, statusTitle(500), `egress config get failed: ${msg}`);
  }
});

// Create a config
router.post('/', zValidator('json', createEgressConfigSchema), async (c) => {
  const orgId = c.get('orgId');
  const body = c.req.valid('json');
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');

  try {
    const {
      modelId,
      egressMode,
      proxyType,
      proxyAddr,
      wgPublicKey,
      wgEndpoint,
      wgAllowedIps,
      wgPersistentKeepalive,
      expectedEgressIp,
      failoverProxyAddrs,
    } = body;
    // Encrypt credentials via the plane before touching the DB.
    const credsJson = credsPayload(body as Record<string, unknown>);
    let encCreds: Uint8Array | null = null;
    let encNonce: Uint8Array | null = null;
    let dekId: string | null = null;
    if (credsJson) {
      const envelope = await encryptCreds(credsJson);
      if (!envelope) {
        return apiError(
          c,
          502,
          statusTitle(502),
          'credential encryption failed — egress plane unreachable',
        );
      }
      encCreds = envelope.encCreds;
      encNonce = envelope.encNonce;
      dekId = envelope.dekId;
    }

    const inserted = await withOrgContext(orgId, (tx) =>
      tx
        .insert(schema.modelNetworkConfigs)
        .values({
          orgId,
          modelId,
          egressMode,
          proxyType: proxyType ?? null,
          proxyAddr: proxyAddr ?? null,
          wgPublicKey: wgPublicKey ?? null,
          wgEndpoint: wgEndpoint ?? null,
          wgAllowedIps: wgAllowedIps ?? null,
          wgPersistentKeepalive: wgPersistentKeepalive ?? null,
          expectedEgressIp: expectedEgressIp ?? null,
          failoverProxyAddrs: failoverProxyAddrs ?? [],
          encCreds: encCreds ?? null,
          encNonce: encNonce ?? null,
          dekId: dekId ?? null,
          healthy: false,
        })
        .returning(),
    );
    return c.json({ data: sanitizeConfig(inserted[0]) }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return apiError(c, 500, statusTitle(500), `egress config create failed: ${msg}`);
  }
});

// Update a config
router.patch('/:id', zValidator('json', updateEgressConfigSchema), async (c) => {
  const orgId = c.get('orgId');
  const { id } = c.req.param();
  const body = c.req.valid('json');
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');

  try {
    const {
      modelId,
      egressMode,
      proxyType,
      proxyAddr,
      wgPublicKey,
      wgEndpoint,
      wgAllowedIps,
      wgPersistentKeepalive,
      expectedEgressIp,
      failoverProxyAddrs,
    } = body;
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (modelId !== undefined) values.modelId = modelId;
    if (egressMode !== undefined) values.egressMode = egressMode;
    if (proxyType !== undefined) values.proxyType = proxyType;
    if (proxyAddr !== undefined) values.proxyAddr = proxyAddr;
    if (wgPublicKey !== undefined) values.wgPublicKey = wgPublicKey;
    if (wgEndpoint !== undefined) values.wgEndpoint = wgEndpoint;
    if (wgAllowedIps !== undefined) values.wgAllowedIps = wgAllowedIps;
    if (wgPersistentKeepalive !== undefined) values.wgPersistentKeepalive = wgPersistentKeepalive;
    if (expectedEgressIp !== undefined) values.expectedEgressIp = expectedEgressIp;
    if (failoverProxyAddrs !== undefined) values.failoverProxyAddrs = failoverProxyAddrs;

    const credsJson = credsPayload(body as Record<string, unknown>);
    if (credsJson) {
      const envelope = await encryptCreds(credsJson);
      if (!envelope) {
        return apiError(
          c,
          502,
          statusTitle(502),
          'credential encryption failed — egress plane unreachable',
        );
      }
      values.encCreds = envelope.encCreds;
      values.encNonce = envelope.encNonce;
      values.dekId = envelope.dekId;
    }

    const updated = await withOrgContext(orgId, (tx) =>
      tx
        .update(schema.modelNetworkConfigs)
        .set(values)
        .where(
          and(eq(schema.modelNetworkConfigs.id, id), eq(schema.modelNetworkConfigs.orgId, orgId)),
        )
        .returning(),
    );
    if (updated.length === 0) return apiError(c, 404, statusTitle(404), 'config not found');
    return c.json({ data: sanitizeConfig(updated[0]) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return apiError(c, 500, statusTitle(500), `egress config update failed: ${msg}`);
  }
});

// Delete a config
router.delete('/:id', async (c) => {
  const orgId = c.get('orgId');
  const { id } = c.req.param();
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  try {
    const deleted = await withOrgContext(orgId, (tx) =>
      tx
        .delete(schema.modelNetworkConfigs)
        .where(
          and(eq(schema.modelNetworkConfigs.id, id), eq(schema.modelNetworkConfigs.orgId, orgId)),
        )
        .returning(),
    );
    if (deleted.length === 0) return apiError(c, 404, statusTitle(404), 'config not found');
    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return apiError(c, 500, statusTitle(500), `egress config delete failed: ${msg}`);
  }
});

// ── Plane proxy endpoints ─────────────────────────────────────────────

// POST /plane/bind — forward a bind request to the egress plane
router.post('/plane/bind', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json().catch(() => ({}));
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return apiError(c, 400, statusTitle(400), 'request body must be an object');
  }
  const payload = body as Record<string, unknown>;
  const modelId = z.string().uuid().safeParse(payload.model_id);
  if (!modelId.success) {
    return apiError(c, 400, statusTitle(400), 'model_id must be a UUID');
  }
  try {
    const ownerOrgId = await withOrgContext(orgId, (tx) => modelOrgId(tx, modelId.data));
    if (ownerOrgId !== orgId) {
      return apiError(c, 404, statusTitle(404), 'model not found');
    }
    const res = await fetch(`${EGRESS_PLANE_URL}/egress/bind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // The authenticated request context is authoritative. Put org_id last
      // so a caller cannot smuggle another tenant into the plane payload.
      body: JSON.stringify({ ...payload, org_id: orgId }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    return c.json(
      { data },
      res.status as 200 | 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 | 504,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return apiError(c, 502, statusTitle(502), `egress plane unreachable: ${msg}`);
  }
});

// POST /plane/unbind — forward an unbind request
router.post('/plane/unbind', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json().catch(() => ({}));
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return apiError(c, 400, statusTitle(400), 'request body must be an object');
  }
  const payload = body as Record<string, unknown>;
  const modelId = z.string().uuid().safeParse(payload.model_id);
  if (!modelId.success) {
    return apiError(c, 400, statusTitle(400), 'model_id must be a UUID');
  }
  try {
    const ownerOrgId = await withOrgContext(orgId, (tx) => modelOrgId(tx, modelId.data));
    if (ownerOrgId !== orgId) {
      return apiError(c, 404, statusTitle(404), 'model not found');
    }
    const res = await fetch(`${EGRESS_PLANE_URL}/egress/unbind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, org_id: orgId }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    return c.json(
      { data },
      res.status as 200 | 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 | 504,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return apiError(c, 502, statusTitle(502), `egress plane unreachable: ${msg}`);
  }
});

// GET /plane/status — live bound-egress status from the plane
router.get('/plane/status', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');

  let res: Response;
  try {
    res = await fetch(`${EGRESS_PLANE_URL}/egress/status`, {
      signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return apiError(c, 502, statusTitle(502), `egress plane unreachable: ${msg}`);
  }

  try {
    const data = await res.json().catch(() => ({}));
    const rows = await withOrgContext(orgId, (tx) =>
      tx
        .select({ modelId: schema.modelNetworkConfigs.modelId })
        .from(schema.modelNetworkConfigs)
        .where(eq(schema.modelNetworkConfigs.orgId, orgId)),
    );
    const allowedModelIds = new Set(
      rows
        .map((row: { modelId?: unknown }) => row.modelId)
        .filter((modelId: unknown): modelId is string => typeof modelId === 'string'),
    );
    const upstreamModels =
      typeof data === 'object' && data !== null && Array.isArray(data.models) ? data.models : [];
    const models = upstreamModels.filter(
      (model: unknown): model is Record<string, unknown> =>
        typeof model === 'object' &&
        model !== null &&
        typeof (model as Record<string, unknown>).model_id === 'string' &&
        allowedModelIds.has((model as Record<string, unknown>).model_id as string),
    );
    const scopedData =
      typeof data === 'object' && data !== null
        ? { ...(data as Record<string, unknown>), count: models.length, models }
        : { count: models.length, models };
    return c.json(
      { data: scopedData },
      res.status as 200 | 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 | 504,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return apiError(c, 500, statusTitle(500), `egress status scope failed: ${msg}`);
  }
});

// POST /plane/sync — ask the plane to sync configs from the DB
router.post('/plane/sync', async (c) => {
  try {
    const res = await fetch(`${EGRESS_PLANE_URL}/egress/sync`, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json().catch(() => ({}));
    return c.json(
      { data },
      res.status as 200 | 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 | 504,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return apiError(c, 502, statusTitle(502), `egress plane unreachable: ${msg}`);
  }
});

// GET /plane/health — plane liveness
router.get('/plane/health', async (c) => {
  try {
    const res = await fetch(`${EGRESS_PLANE_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    const data = await res.json().catch(() => ({}));
    return c.json(
      { data },
      res.status as 200 | 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 | 504,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return apiError(c, 502, statusTitle(502), `egress plane unreachable: ${msg}`);
  }
});

export { router as egressRouter };
