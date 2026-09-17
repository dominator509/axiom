// ─── Agent permission administration (F-46, L2.11) ─────────────────────────
// Grants are dashboard-only. Raw capability tokens are returned once at
// issuance and are never stored; later requests see only safe metadata.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { Tier, createCapabilityTokenWithMetadata } from '@axiom/mcp-server';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, apiError, statusTitle, writeAudit } from './helpers.js';
import { readBoundedJson, RequestBodyTooLargeError } from '../webhook-body.js';

const router = new Hono<AppBindings>();
const tierSchema = z.enum([Tier.Viewer, Tier.Operator, Tier.Manager, Tier.Autonomous]);
const permissionBody = z.object({
  agentRef: z.string().trim().min(1).max(128).optional(),
  tier: tierSchema.optional(),
  canPublish: z.boolean().optional(),
  canEdit: z.boolean().optional(),
});
const tokenBody = z.object({ ttlSeconds: z.number().int().min(60).max(900).optional() });

async function body(c: Context<AppBindings>): Promise<unknown> {
  try { return await readBoundedJson(c.req.raw, 32 * 1024); }
  catch (error) {
    if (error instanceof RequestBodyTooLargeError) throw error;
    return {};
  }
}

router.get('/models/:modelId/agent-permissions', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const modelId = c.req.param('modelId');
  const data = await withOrgContext(orgId, async (tx) => {
    const permissions = await tx.select().from(schema.agentPermission)
      .where(and(eq(schema.agentPermission.orgId, orgId), eq(schema.agentPermission.modelId, modelId)))
      .orderBy(desc(schema.agentPermission.updatedAt));
    const tokens = await tx.select({
      tokenId: schema.mcpCapabilityToken.tokenId,
      permissionId: schema.mcpCapabilityToken.permissionId,
      expiresAt: schema.mcpCapabilityToken.expiresAt,
      revokedAt: schema.mcpCapabilityToken.revokedAt,
    }).from(schema.mcpCapabilityToken)
      .where(and(eq(schema.mcpCapabilityToken.orgId, orgId), eq(schema.mcpCapabilityToken.modelId, modelId)))
      .orderBy(desc(schema.mcpCapabilityToken.issuedAt));
    return permissions.map((permission: typeof schema.agentPermission.$inferSelect) => ({
      ...permission,
      tokens: tokens.filter((token: typeof schema.mcpCapabilityToken.$inferSelect) => token.permissionId === permission.id),
    }));
  });
  return c.json({ data });
});

router.post('/models/:modelId/agent-permissions', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  let payload: unknown;
  try { payload = await body(c); }
  catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'agent permission body too large'); payload = {}; }
  const parsed = permissionBody.safeParse(payload);
  if (!parsed.success || !parsed.data.agentRef || !parsed.data.tier) return apiError(c, 400, statusTitle(400), 'agentRef and tier are required');
  const modelId = c.req.param('modelId');
  const userId = c.get('userId') ?? 'system';
  const saved = await withOrgContext(orgId, async (tx) => {
    const existing = await tx.select().from(schema.agentPermission).where(and(
      eq(schema.agentPermission.orgId, orgId), eq(schema.agentPermission.modelId, modelId), eq(schema.agentPermission.agentRef, parsed.data.agentRef!),
    )).limit(1);
    const values = { tier: parsed.data.tier!, canPublish: parsed.data.canPublish ?? false, canEdit: parsed.data.canEdit ?? true, updatedAt: new Date() };
    const result = existing[0]
      ? await tx.update(schema.agentPermission).set(values).where(eq(schema.agentPermission.id, existing[0].id)).returning()
      : await tx.insert(schema.agentPermission).values({ orgId, modelId, agentRef: parsed.data.agentRef!, ...values }).returning();
    if (result[0]) await writeAudit(tx, orgId, userId, existing[0] ? 'agent.permission.update' : 'agent.permission.create', result[0].id, { modelId, agentRef: result[0].agentRef, tier: result[0].tier, canPublish: result[0].canPublish, canEdit: result[0].canEdit });
    return result[0] ?? null;
  });
  if (!saved) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: saved }, 201);
});

router.patch('/models/:modelId/agent-permissions/:permissionId', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  let payload: unknown;
  try { payload = await body(c); }
  catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'agent permission body too large'); payload = {}; }
  const parsed = permissionBody.safeParse(payload);
  if (!parsed.success || Object.keys(parsed.data).length === 0) return apiError(c, 400, statusTitle(400), 'invalid agent permission body');
  const modelId = c.req.param('modelId');
  const permissionId = c.req.param('permissionId');
  const userId = c.get('userId') ?? 'system';
  const saved = await withOrgContext(orgId, async (tx) => {
    const result = await tx.update(schema.agentPermission).set({ ...parsed.data, updatedAt: new Date() }).where(and(
      eq(schema.agentPermission.id, permissionId), eq(schema.agentPermission.orgId, orgId), eq(schema.agentPermission.modelId, modelId),
    )).returning();
    if (result[0]) await writeAudit(tx, orgId, userId, 'agent.permission.update', permissionId, { modelId, changes: parsed.data });
    return result[0] ?? null;
  });
  if (!saved) return apiError(c, 404, statusTitle(404), 'agent permission not found');
  return c.json({ data: saved });
});

router.delete('/models/:modelId/agent-permissions/:permissionId', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const modelId = c.req.param('modelId');
  const permissionId = c.req.param('permissionId');
  const userId = c.get('userId') ?? 'system';
  const deleted = await withOrgContext(orgId, async (tx) => {
    const result = await tx.delete(schema.agentPermission).where(and(
      eq(schema.agentPermission.id, permissionId), eq(schema.agentPermission.orgId, orgId), eq(schema.agentPermission.modelId, modelId),
    )).returning({ id: schema.agentPermission.id });
    if (result[0]) await writeAudit(tx, orgId, userId, 'agent.permission.delete', permissionId, { modelId });
    return result[0] ?? null;
  });
  if (!deleted) return apiError(c, 404, statusTitle(404), 'agent permission not found');
  return c.json({ data: deleted });
});

router.post('/models/:modelId/agent-permissions/:permissionId/tokens', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  let payload: unknown;
  try { payload = await body(c); }
  catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'token body too large'); payload = {}; }
  const parsed = tokenBody.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid token body');
  const modelId = c.req.param('modelId');
  const permissionId = c.req.param('permissionId');
  const userId = c.get('userId') ?? 'system';
  const issued = await withOrgContext(orgId, async (tx) => {
    const [permission] = await tx.select().from(schema.agentPermission).where(and(
      eq(schema.agentPermission.id, permissionId), eq(schema.agentPermission.orgId, orgId), eq(schema.agentPermission.modelId, modelId),
    )).limit(1);
    if (!permission) return null;
    const grant = createCapabilityTokenWithMetadata(modelId, permission.tier as Tier, permission.agentRef, (parsed.data.ttlSeconds ?? 900) * 1000);
    await tx.insert(schema.mcpCapabilityToken).values({
      tokenId: grant.tokenId, orgId, permissionId, modelId, agentRef: permission.agentRef, tier: permission.tier,
      expiresAt: new Date(grant.expiresAt),
    });
    await writeAudit(tx, orgId, userId, 'agent.token.issue', permissionId, { modelId, agentRef: permission.agentRef, tier: permission.tier, tokenId: grant.tokenId, expiresAt: grant.expiresAt });
    return { ...grant, agentRef: permission.agentRef, tier: permission.tier };
  });
  if (!issued) return apiError(c, 404, statusTitle(404), 'agent permission not found');
  return c.json({ data: issued, warning: 'Copy this token now. It is not stored or shown again.' }, 201);
});

router.post('/models/:modelId/agent-permissions/:permissionId/tokens/:tokenId/revoke', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const modelId = c.req.param('modelId');
  const permissionId = c.req.param('permissionId');
  const tokenId = c.req.param('tokenId');
  const userId = c.get('userId') ?? 'system';
  const result = await withOrgContext(orgId, async (tx) => {
    const [token] = await tx.select().from(schema.mcpCapabilityToken).where(and(
      eq(schema.mcpCapabilityToken.tokenId, tokenId), eq(schema.mcpCapabilityToken.orgId, orgId), eq(schema.mcpCapabilityToken.modelId, modelId), eq(schema.mcpCapabilityToken.permissionId, permissionId),
    )).limit(1);
    if (!token) return null;
    if (!token.revokedAt) {
      await tx.update(schema.mcpCapabilityToken).set({ revokedAt: new Date() }).where(eq(schema.mcpCapabilityToken.tokenId, tokenId));
      await tx.insert(schema.mcpTokenRevocation).values({ tokenId, expiresAt: token.expiresAt }).onConflictDoNothing();
      await writeAudit(tx, orgId, userId, 'agent.token.revoke', permissionId, { modelId, tokenId });
    }
    return { tokenId, revoked: true };
  });
  if (!result) return apiError(c, 404, statusTitle(404), 'agent token not found');
  return c.json({ data: result });
});

export { router as agentPermissionsRouter };
