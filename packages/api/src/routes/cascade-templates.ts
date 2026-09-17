// ─── Cross-platform cascade schedules (F-11) ──────────────────────────────
// Templates are persisted; expansion creates ordinary consent-checked,
// connection-bound post targets and publish.target jobs in one transaction.

import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { schema, getPublishingConsentStatus, consentRequirementMessage } from '@axiom/db';
import { asPlatform, enqueueJob, resolveCapabilities } from '@axiom/worker';
import type { Platform } from '@axiom/core';
import type { AppBindings } from '../index.js';
import type { Context } from 'hono';
import { withOrgContext, requireOrg, apiError, statusTitle, writeAudit, resolvePublishConnections } from './helpers.js';
import { readBoundedJson, RequestBodyTooLargeError } from '../webhook-body.js';

const router = new Hono<AppBindings>();
const stepSchema = z.object({ platform: z.string().min(1).max(50), offsetMinutes: z.number().int().min(0).max(10_080) }).strict();
const createSchema = z.object({ name: z.string().trim().min(1).max(120), steps: z.array(stepSchema).min(1).max(10), enabled: z.boolean().optional() }).strict();
const patchSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), steps: z.array(stepSchema).min(1).max(10).optional(), enabled: z.boolean().optional() }).strict();
const expandSchema = z.object({ bundleId: z.string().uuid(), baseScheduledFor: z.string().datetime(), connectionIds: z.record(z.string(), z.string().uuid()).optional() }).strict();

function parseSteps(steps: z.infer<typeof stepSchema>[]): { steps: Array<{ platform: Platform; offsetMinutes: number }>; error?: string } {
  let previous = -1;
  const parsed: Array<{ platform: Platform; offsetMinutes: number }> = [];
  for (const step of steps) {
    if (step.offsetMinutes < previous) return { steps: [], error: 'cascade offsets must be in ascending order' };
    try { parsed.push({ platform: asPlatform(step.platform), offsetMinutes: step.offsetMinutes }); }
    catch { return { steps: [], error: `unsupported cascade platform '${step.platform}'` }; }
    previous = step.offsetMinutes;
  }
  if (parsed[0]?.offsetMinutes !== 0) return { steps: [], error: 'the first cascade step must start at offset 0' };
  return { steps: parsed };
}

function mediaError(platform: Platform, kind: string | null): string | null {
  const media = resolveCapabilities(platform).media;
  if (!kind) return media.includes('text') ? null : `${platform} requires a media asset`;
  return media.includes(kind as 'image' | 'video') ? null : `${platform} does not support ${kind} assets`;
}

async function readBody(c: Context<AppBindings>): Promise<unknown> {
  try { return await readBoundedJson(c.req.raw, 64 * 1024); }
  catch (error) { if (error instanceof RequestBodyTooLargeError) throw error; return {}; }
}

router.get('/models/:modelId/cascade-templates', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const rows = await withOrgContext(orgId, (tx) => tx.select().from(schema.cascadeTemplate)
    .where(and(eq(schema.cascadeTemplate.orgId, orgId), eq(schema.cascadeTemplate.modelId, c.req.param('modelId'))))
    .orderBy(desc(schema.cascadeTemplate.updatedAt)));
  return c.json({ data: rows });
});

router.post('/models/:modelId/cascade-templates', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  let payload: unknown;
  try { payload = await readBody(c); } catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'cascade template body too large'); payload = {}; }
  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid cascade template');
  const checked = parseSteps(parsed.data.steps);
  if (checked.error) return apiError(c, 400, statusTitle(400), checked.error);
  const modelId = c.req.param('modelId');
  const userId = c.get('userId') ?? 'system';
  const saved = await withOrgContext(orgId, async (tx) => {
    const model = await tx.select({ id: schema.modelProfile.id }).from(schema.modelProfile).where(and(eq(schema.modelProfile.id, modelId), eq(schema.modelProfile.orgId, orgId))).limit(1);
    if (!model[0]) return null;
    const [row] = await tx.insert(schema.cascadeTemplate).values({ orgId, modelId, name: parsed.data.name, steps: checked.steps, enabled: parsed.data.enabled ?? true }).returning();
    if (row) await writeAudit(tx, orgId, userId, 'cascade.template.create', row.id, { modelId, name: row.name, stepCount: checked.steps.length });
    return row ?? null;
  });
  if (!saved) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: saved }, 201);
});

router.patch('/models/:modelId/cascade-templates/:templateId', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  let payload: unknown;
  try { payload = await readBody(c); } catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'cascade template body too large'); payload = {}; }
  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success || Object.keys(parsed.data).length === 0) return apiError(c, 400, statusTitle(400), 'invalid cascade template update');
  const checked = parsed.data.steps ? parseSteps(parsed.data.steps) : null;
  if (checked?.error) return apiError(c, 400, statusTitle(400), checked.error);
  const modelId = c.req.param('modelId');
  const templateId = c.req.param('templateId');
  const updated = await withOrgContext(orgId, async (tx) => {
    const [row] = await tx.update(schema.cascadeTemplate).set({ ...parsed.data, ...(checked?.steps ? { steps: checked.steps } : {}), updatedAt: new Date() }).where(and(eq(schema.cascadeTemplate.id, templateId), eq(schema.cascadeTemplate.modelId, modelId), eq(schema.cascadeTemplate.orgId, orgId))).returning();
    if (row) await writeAudit(tx, orgId, c.get('userId') ?? 'system', 'cascade.template.update', templateId, { modelId });
    return row ?? null;
  });
  if (!updated) return apiError(c, 404, statusTitle(404), 'cascade template not found');
  return c.json({ data: updated });
});

router.delete('/models/:modelId/cascade-templates/:templateId', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const deleted = await withOrgContext(orgId, async (tx) => {
    const rows = await tx.delete(schema.cascadeTemplate).where(and(eq(schema.cascadeTemplate.id, c.req.param('templateId')), eq(schema.cascadeTemplate.modelId, c.req.param('modelId')), eq(schema.cascadeTemplate.orgId, orgId))).returning({ id: schema.cascadeTemplate.id });
    if (rows[0]) await writeAudit(tx, orgId, c.get('userId') ?? 'system', 'cascade.template.delete', rows[0].id, { modelId: c.req.param('modelId') });
    return rows[0] ?? null;
  });
  if (!deleted) return apiError(c, 404, statusTitle(404), 'cascade template not found');
  return c.json({ data: deleted });
});

router.post('/models/:modelId/cascade-templates/:templateId/expand', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  let payload: unknown;
  try { payload = await readBody(c); } catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'cascade expansion body too large'); payload = {}; }
  const parsed = expandSchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'bundleId and baseScheduledFor are required');
  const base = new Date(parsed.data.baseScheduledFor);
  if (Number.isNaN(base.getTime()) || base.getTime() <= Date.now()) return apiError(c, 400, statusTitle(400), 'baseScheduledFor must be in the future');
  const modelId = c.req.param('modelId');
  const templateId = c.req.param('templateId');
  const result = await withOrgContext(orgId, async (tx) => {
    const [template] = await tx.select().from(schema.cascadeTemplate).where(and(eq(schema.cascadeTemplate.id, templateId), eq(schema.cascadeTemplate.modelId, modelId), eq(schema.cascadeTemplate.orgId, orgId))).limit(1);
    if (!template) return { status: 404 as const, error: 'cascade template not found' };
    if (!template.enabled) return { status: 409 as const, error: 'cascade template is disabled' };
    const [bundle] = await tx.select({ id: schema.contentBundle.id, state: schema.contentBundle.state, assetId: schema.contentBundle.assetId }).from(schema.contentBundle).where(and(eq(schema.contentBundle.id, parsed.data.bundleId), eq(schema.contentBundle.orgId, orgId), eq(schema.contentBundle.modelId, modelId))).limit(1);
    if (!bundle) return { status: 404 as const, error: 'bundle not found' };
    if (bundle.state !== 'approved') return { status: 409 as const, error: `bundle must be approved before cascading (current state: ${bundle.state})` };
    let kind: string | null = null;
    if (bundle.assetId) {
      const [asset] = await tx.select({ kind: schema.asset.kind }).from(schema.asset).where(and(eq(schema.asset.id, bundle.assetId), eq(schema.asset.orgId, orgId), eq(schema.asset.modelId, modelId))).limit(1);
      kind = asset?.kind ?? null;
    }
    const steps = template.steps as Array<{ platform: string; offsetMinutes: number }>;
    const platforms = [...new Set(steps.map(step => step.platform))];
    for (const platform of platforms) {
      const consent = await getPublishingConsentStatus(tx, orgId, modelId, platform as Platform);
      if (!consent.ok) return { status: 409 as const, error: consentRequirementMessage(consent, platform as Platform) };
      const error = mediaError(platform as Platform, kind);
      if (error) return { status: 409 as const, error };
    }
    const connections = await resolvePublishConnections(tx, orgId, modelId, platforms, parsed.data.connectionIds ?? {});
    if ('error' in connections) return { status: 409 as const, error: connections.error };
    const created = [];
    for (const step of steps) {
      const scheduledFor = new Date(base.getTime() + step.offsetMinutes * 60_000);
      const idemKey = Buffer.from(`${bundle.id}|${step.platform}|${scheduledFor.toISOString()}`);
      const [row] = await tx.insert(schema.postTarget).values({ orgId, bundleId: bundle.id, platform: step.platform as Platform, connectionId: connections.connections.get(step.platform), scheduledFor, state: 'pending', idemKey }).onConflictDoNothing().returning();
      if (row) {
        created.push(row);
        await enqueueJob(tx, { orgId, queue: 'publish', kind: 'publish.target', payload: { targetId: row.id }, runAfter: scheduledFor, dedupeParts: ['publish.target', row.id] });
      }
    }
    await writeAudit(tx, orgId, c.get('userId') ?? 'system', 'cascade.template.expand', templateId, { modelId, bundleId: bundle.id, count: created.length });
    return { status: 201 as const, data: created };
  });
  if (result.status !== 201) return apiError(c, result.status, statusTitle(result.status), result.error);
  return c.json({ data: result.data, meta: { total: result.data.length } }, 201);
});

export { router as cascadeTemplatesRouter };
