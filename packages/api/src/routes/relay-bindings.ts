// ─── Relay channel bindings (F-71, L2.7) ───────────────────────────────────
// Bind a model's approval cards to an operator-controlled channel reference.
// Credentials stay deployment-owned; this route only stores the model-scoped
// destination and never accepts bot tokens or provider secrets.

import { Hono } from 'hono';
import { z } from 'zod';
import { boundedJsonValidator as zValidator } from '../bounded-json-validator.js';
import { and, eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { apiError, modelOrgId, requireOrg, statusTitle, withOrgContext, writeAudit } from './helpers.js';

const router = new Hono<AppBindings>();
const channels = ['telegram', 'discord', 'signal', 'imessage'] as const;
const channelSchema = z.enum(channels);
const createSchema = z.object({
  channel: channelSchema,
  chatRef: z.string().trim().min(1).max(256),
  enabled: z.boolean().optional(),
});
const updateSchema = z.object({
  chatRef: z.string().trim().min(1).max(256).optional(),
  enabled: z.boolean().optional(),
}).refine(body => Object.keys(body).length > 0, 'At least one binding field is required');

function publicBinding(row: { id: string; modelId: string; channel: string; chatRef: string | null; enabled: boolean; createdAt: Date }) {
  return { id: row.id, modelId: row.modelId, channel: row.channel, chatRef: row.chatRef, enabled: row.enabled, createdAt: row.createdAt };
}

router.get('/models/:modelId/relay-bindings', async c => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const modelId = c.req.param('modelId');
  const rows = await withOrgContext(orgId, tx => tx.select().from(schema.relayBinding).where(
    and(eq(schema.relayBinding.orgId, orgId), eq(schema.relayBinding.modelId, modelId)),
  ).orderBy(schema.relayBinding.createdAt));
  return c.json({ data: rows.map(publicBinding), meta: { total: rows.length } });
});

router.post('/models/:modelId/relay-bindings', zValidator('json', createSchema), async c => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const modelId = c.req.param('modelId');
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';
  const saved = await withOrgContext(orgId, async tx => {
    if ((await modelOrgId(tx, modelId)) !== orgId) return null;
    const existing = await tx.select().from(schema.relayBinding).where(and(
      eq(schema.relayBinding.orgId, orgId), eq(schema.relayBinding.modelId, modelId),
      eq(schema.relayBinding.channel, body.channel), eq(schema.relayBinding.chatRef, body.chatRef),
    )).limit(1);
    const row = existing[0]
      ? (await tx.update(schema.relayBinding).set({ enabled: body.enabled ?? true }).where(eq(schema.relayBinding.id, existing[0].id)).returning())[0]
      : (await tx.insert(schema.relayBinding).values({ orgId, modelId, channel: body.channel, chatRef: body.chatRef, enabled: body.enabled ?? true }).returning())[0];
    await writeAudit(tx, orgId, userId, 'relay.binding.upsert', row.id, { modelId, channel: body.channel, chatRef: body.chatRef, enabled: row.enabled });
    return row;
  });
  if (!saved) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: publicBinding(saved) }, 201);
});

router.patch('/models/:modelId/relay-bindings/:id', zValidator('json', updateSchema), async c => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const modelId = c.req.param('modelId');
  const bindingId = c.req.param('id');
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';
  const updated = await withOrgContext(orgId, async tx => {
    const rows = await tx.update(schema.relayBinding).set(body).where(and(
      eq(schema.relayBinding.id, bindingId), eq(schema.relayBinding.orgId, orgId), eq(schema.relayBinding.modelId, modelId),
    )).returning();
    if (rows.length > 0) await writeAudit(tx, orgId, userId, 'relay.binding.update', bindingId, { modelId, ...body });
    return rows;
  });
  if (updated.length === 0) return apiError(c, 404, statusTitle(404), 'relay binding not found');
  return c.json({ data: publicBinding(updated[0]) });
});

export { router as relayBindingsRouter };
