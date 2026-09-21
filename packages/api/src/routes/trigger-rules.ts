// ─── Model trigger rules (F-19–F-21) ─────────────────────────────────────
// Rules are persisted configuration. Evaluation is performed by the worker
// after a real metrics observation; this route never claims that saving a rule
// has already fired it.

import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { asPlatform } from '@axiom/worker';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import type { Context } from 'hono';
import { withOrgContext, requireOrg, apiError, statusTitle, writeAudit } from './helpers.js';
import { readBoundedJson, RequestBodyTooLargeError } from '../webhook-body.js';

const router = new Hono<AppBindings>();

const conditionSchema = z.object({
  metric: z.enum(['views', 'likes', 'comments', 'shares', 'engagementRate']),
  thresholdMode: z.enum(['fixed', 'learned_p90']).default('fixed'),
  threshold: z.number().finite().min(0).max(1_000_000_000_000).optional(),
  minimumSamples: z.number().int().min(4).max(1_000).optional(),
  windowMinutes: z.number().int().min(1).max(10_080).optional(),
}).strict().superRefine((condition, ctx) => {
  if (condition.thresholdMode === 'fixed' && condition.threshold === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['threshold'], message: 'fixed threshold required' });
  }
  if (condition.thresholdMode === 'learned_p90' && condition.threshold !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['threshold'], message: 'learned threshold is server-derived' });
  }
});

const actionSchema = z.object({
  type: z.enum(['content.generate', 'relay.card']),
  prompt: z.string().trim().min(1).max(2_000).optional(),
  style: z.string().trim().min(1).max(200).optional(),
  outfit: z.string().trim().min(1).max(200).optional(),
  location: z.string().trim().min(1).max(200).optional(),
  mood: z.string().trim().min(1).max(200).optional(),
  lighting: z.string().trim().min(1).max(200).optional(),
  aspectRatio: z.enum(['1:1', '4:5', '9:16', '16:9']).optional(),
  cooldownMinutes: z.number().int().min(1).max(10_080).optional(),
}).strict();

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  platform: z.string().trim().min(1).max(50),
  condition: conditionSchema,
  action: actionSchema,
  enabled: z.boolean().optional(),
}).strict();

const patchSchema = createSchema.partial().strict();

function parsePlatform(value: string): string | null {
  try { return asPlatform(value); } catch { return null; }
}

async function readBody(c: Context<AppBindings>): Promise<unknown> {
  try { return await readBoundedJson(c.req.raw, 64 * 1024); }
  catch (error) { if (error instanceof RequestBodyTooLargeError) throw error; return {}; }
}

router.get('/models/:modelId/trigger-rules', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const rows = await withOrgContext(orgId, (tx) => tx.select().from(schema.triggerRule)
    .where(and(eq(schema.triggerRule.orgId, orgId), eq(schema.triggerRule.modelId, c.req.param('modelId'))))
    .orderBy(desc(schema.triggerRule.createdAt)));
  return c.json({ data: rows });
});

router.post('/models/:modelId/trigger-rules', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  let payload: unknown;
  try { payload = await readBody(c); }
  catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'trigger rule body too large'); payload = {}; }
  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid trigger rule');
  const platform = parsePlatform(parsed.data.platform);
  if (!platform) return apiError(c, 400, statusTitle(400), `unsupported trigger platform '${parsed.data.platform}'`);
  const modelId = c.req.param('modelId');
  const saved = await withOrgContext(orgId, async (tx) => {
    const model = await tx.select({ id: schema.modelProfile.id }).from(schema.modelProfile)
      .where(and(eq(schema.modelProfile.id, modelId), eq(schema.modelProfile.orgId, orgId))).limit(1);
    if (!model[0]) return null;
    const [row] = await tx.insert(schema.triggerRule).values({
      orgId, modelId, name: parsed.data.name, platform,
      condition: parsed.data.condition, action: parsed.data.action,
      enabled: parsed.data.enabled ?? true,
    }).returning();
    if (row) await writeAudit(tx, orgId, c.get('userId') ?? 'system', 'trigger.rule.create', row.id, { modelId, platform });
    return row ?? null;
  });
  if (!saved) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: saved }, 201);
});

router.patch('/models/:modelId/trigger-rules/:ruleId', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  let payload: unknown;
  try { payload = await readBody(c); }
  catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'trigger rule body too large'); payload = {}; }
  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success || Object.keys(parsed.data).length === 0) return apiError(c, 400, statusTitle(400), 'invalid trigger rule update');
  const platform = parsed.data.platform === undefined ? undefined : parsePlatform(parsed.data.platform);
  if (parsed.data.platform !== undefined && !platform) return apiError(c, 400, statusTitle(400), `unsupported trigger platform '${parsed.data.platform}'`);
  const values = { ...parsed.data, ...(platform ? { platform } : {}) };
  const updated = await withOrgContext(orgId, async (tx) => {
    const [row] = await tx.update(schema.triggerRule).set(values).where(and(
      eq(schema.triggerRule.id, c.req.param('ruleId')),
      eq(schema.triggerRule.modelId, c.req.param('modelId')),
      eq(schema.triggerRule.orgId, orgId),
    )).returning();
    if (row) await writeAudit(tx, orgId, c.get('userId') ?? 'system', 'trigger.rule.update', row.id, { modelId: c.req.param('modelId') });
    return row ?? null;
  });
  if (!updated) return apiError(c, 404, statusTitle(404), 'trigger rule not found');
  return c.json({ data: updated });
});

router.delete('/models/:modelId/trigger-rules/:ruleId', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const deleted = await withOrgContext(orgId, async (tx) => {
    const rows = await tx.delete(schema.triggerRule).where(and(
      eq(schema.triggerRule.id, c.req.param('ruleId')),
      eq(schema.triggerRule.modelId, c.req.param('modelId')),
      eq(schema.triggerRule.orgId, orgId),
    )).returning({ id: schema.triggerRule.id });
    if (rows[0]) await writeAudit(tx, orgId, c.get('userId') ?? 'system', 'trigger.rule.delete', rows[0].id, { modelId: c.req.param('modelId') });
    return rows[0] ?? null;
  });
  if (!deleted) return apiError(c, 404, statusTitle(404), 'trigger rule not found');
  return c.json({ data: deleted });
});

export { router as triggerRulesRouter };
