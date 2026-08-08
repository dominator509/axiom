// ─── Social accounts per model (F-58..F-67, L3.0) — real DB CRUD ───
// platform_connection rows store envelope-encrypted credentials (LBI-01).
// Capabilities are resolved from the connector registry at connect time.

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, writeAudit, apiError, statusTitle } from './helpers.js';

const router = new Hono<AppBindings>();

const PLATFORMS = [
  'instagram',
  'tiktok',
  'x',
  'youtube',
  'reddit',
  'threads',
  'discord',
  'telegram',
  'facebook',
  'snapchat',
  'fanvue',
] as const;

const connectSchema = z.object({
  platform: z.enum(PLATFORMS),
  displayName: z.string().min(1).max(100),
  // Envelope-encrypted credential fields (never plaintext at rest — LBI-01).
  // The API accepts base64 ciphertext produced by the egress-plane's
  // /egress/encrypt endpoint (same envelope used by model_network_configs).
  encToken: z.string().min(1),
  encNonce: z.string().min(1),
  dekId: z.string().min(1),
  capabilities: z.array(z.string()).optional(),
});

// GET /api/v1/social-accounts?modelId=... — connected accounts
router.get('/', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const modelId = c.req.query('modelId');

  const rows = await withOrgContext(orgId, (tx) => {
    const conds = [eq(schema.platformConnection.orgId, orgId)];
    if (modelId) conds.push(eq(schema.platformConnection.modelId, modelId));
    return tx
      .select()
      .from(schema.platformConnection)
      .where(and(...conds))
      .orderBy(schema.platformConnection.connectedAt);
  });
  return c.json({ data: rows, meta: { total: rows.length } });
});

// POST /api/v1/social-accounts — connect a platform account
router.post('/', zValidator('json', connectSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';
  const modelId = c.req.query('modelId');
  if (!modelId) return apiError(c, 400, statusTitle(400), 'modelId query required');

  const inserted = await withOrgContext(orgId, async (tx) => {
    const [row] = await tx
      .insert(schema.platformConnection)
      .values({
        orgId,
        modelId,
        platform: body.platform,
        displayName: body.displayName,
        encToken: new Uint8Array(Buffer.from(body.encToken, 'base64')),
        encNonce: new Uint8Array(Buffer.from(body.encNonce, 'base64')),
        dekId: body.dekId,
        capabilities: body.capabilities ?? [],
        status: 'connected',
        connectedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      const existing = await tx
        .select()
        .from(schema.platformConnection)
        .where(
          and(
            eq(schema.platformConnection.orgId, orgId),
            eq(schema.platformConnection.modelId, modelId),
            eq(schema.platformConnection.platform, body.platform),
          ),
        )
        .limit(1);
      return existing[0] ?? null;
    }
    await writeAudit(tx, orgId, userId, 'social.connect', row.id, {
      platform: body.platform,
      modelId,
      displayName: body.displayName,
    });
    return row;
  });
  if (!inserted) return apiError(c, 500, statusTitle(500), 'connect failed');
  return c.json({ data: inserted }, 201);
});

// DELETE /api/v1/social-accounts/:id — revoke
router.delete('/:id', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { id } = c.req.param();
  const userId = c.get('userId') ?? 'system';

  const result = await withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .delete(schema.platformConnection)
      .where(and(eq(schema.platformConnection.id, id), eq(schema.platformConnection.orgId, orgId)))
      .returning({
        id: schema.platformConnection.id,
        platform: schema.platformConnection.platform,
      });
    if (rows.length === 0) return { status: 404 as const, data: null };
    await writeAudit(tx, orgId, userId, 'social.revoke', id, { platform: rows[0].platform });
    return { status: 200 as const, data: rows[0] };
  });
  if (result.status === 404) return apiError(c, 404, statusTitle(404), 'connection not found');
  return c.json({ success: true, data: result.data });
});

export { router as socialRouter };
