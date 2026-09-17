// ─── Variant experiments (F-13/F-15/F-16) ─────────────────────────────────
// This is an assignment/outcome control plane. It never publishes a bundle or
// bypasses ToS, consent, approval, scheduling, or the model egress boundary.

import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { asPlatform } from '@axiom/worker';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import type { Context } from 'hono';
import { withOrgContext, requireOrg, apiError, statusTitle, writeAudit } from './helpers.js';
import { readBoundedJson, RequestBodyTooLargeError } from '../webhook-body.js';
import { parseCursor, cursorLt, nextCursor } from '../contract.js';

const router = new Hono<AppBindings>();

router.get('/models/:modelId/variant-experiments/candidates', async c => {
  const orgId = requireOrg(c), modelId = c.req.param('modelId');
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  if (!z.string().uuid().safeParse(modelId).success) return apiError(c, 400, statusTitle(400), 'Invalid model');
  const { limit, cursor } = parseCursor(c, 20, 100);
  const rows = await withOrgContext(orgId, tx => tx.select({
    id: schema.assetVariant.id, variantType: schema.assetVariant.variantType,
    outputAssetId: schema.assetVariant.outputAssetId, createdAt: schema.assetVariant.createdAt,
  }).from(schema.assetVariant).innerJoin(schema.asset, eq(schema.asset.id, schema.assetVariant.assetId))
    .where(and(eq(schema.assetVariant.orgId, orgId), eq(schema.asset.orgId, orgId), eq(schema.asset.modelId, modelId),
      ...cursorLt(schema.assetVariant.createdAt, schema.assetVariant.id, cursor)))
    .orderBy(desc(schema.assetVariant.createdAt), desc(schema.assetVariant.id)).limit(limit));
  const last = rows[rows.length - 1];
  return c.json({ data: rows, meta: { next_cursor: nextCursor(last?.createdAt, last?.id, limit, rows.length) } });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  platform: z.string().trim().min(1).max(50),
  variantIds: z.array(z.string().uuid()).min(2).max(10),
}).strict();
const patchSchema = z.object({ status: z.enum(['draft', 'running', 'paused']) }).strict();
const assignmentSchema = z.object({ assignmentKey: z.string().trim().min(1).max(256) }).strict();
const outcomeSchema = z.object({
  assignmentId: z.string().uuid(),
  converted: z.boolean(),
  metricValue: z.number().finite().min(-1_000_000_000).max(1_000_000_000).optional(),
}).strict();
const promoteSchema = z.object({ variantId: z.string().uuid() }).strict();

async function readBody(c: Context<AppBindings>): Promise<unknown> {
  try { return await readBoundedJson(c.req.raw, 64 * 1024); }
  catch (error) {
    if (error instanceof RequestBodyTooLargeError) throw error;
    return {};
  }
}

function canonicalPlatform(value: string): string | null {
  try { return asPlatform(value); } catch { return null; }
}

function stableKey(experimentId: string, assignmentKey: string): string {
  return createHash('sha256').update(`${experimentId}:${assignmentKey}`).digest('hex');
}

async function ownedVariants(tx: any, orgId: string, modelId: string, variantIds: string[]) {
  const rows = await tx.select({ id: schema.assetVariant.id })
    .from(schema.assetVariant)
    .innerJoin(schema.asset, eq(schema.asset.id, schema.assetVariant.assetId))
    .where(and(
      eq(schema.assetVariant.orgId, orgId),
      eq(schema.asset.orgId, orgId),
      eq(schema.asset.modelId, modelId),
      inArray(schema.assetVariant.id, variantIds),
    ));
  return rows.map((row: { id: string }) => row.id);
}

router.get('/models/:modelId/variant-experiments', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const modelId = c.req.param('modelId');
  const data = await withOrgContext(orgId, async (tx) => {
    const experiments = await tx.select().from(schema.variantExperiment)
      .where(and(eq(schema.variantExperiment.orgId, orgId), eq(schema.variantExperiment.modelId, modelId)))
      .orderBy(desc(schema.variantExperiment.updatedAt));
    if (experiments.length === 0) return [];
    const assignments = await tx.select({
      experimentId: schema.variantExperimentAssignment.experimentId,
      variantId: schema.variantExperimentAssignment.variantId,
      converted: schema.variantExperimentAssignment.converted,
      metricValue: schema.variantExperimentAssignment.metricValue,
      outcomeAt: schema.variantExperimentAssignment.outcomeAt,
    }).from(schema.variantExperimentAssignment).where(and(
      eq(schema.variantExperimentAssignment.orgId, orgId),
      inArray(schema.variantExperimentAssignment.experimentId, experiments.map((row: { id: string }) => row.id)),
    ));
    return experiments.map((experiment: { id: string; variantIds: string[] }) => {
      const rows = assignments.filter((assignment: { experimentId: string }) => assignment.experimentId === experiment.id);
      return {
        ...experiment,
        stats: experiment.variantIds.map((variantId: string) => {
          const variantRows = rows.filter((row: { variantId: string }) => row.variantId === variantId);
          const completed = variantRows.filter((row: { outcomeAt: Date | null }) => row.outcomeAt !== null);
          const total = completed.reduce((sum: number, row: { metricValue: number | null }) => sum + (row.metricValue ?? 0), 0);
          return { variantId, exposures: variantRows.length, outcomes: completed.length,
            conversions: completed.filter((row: { converted: boolean }) => row.converted).length, metricTotal: total };
        }),
      };
    });
  });
  return c.json({ data });
});

router.post('/models/:modelId/variant-experiments', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  let payload: unknown;
  try { payload = await readBody(c); }
  catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'experiment body too large'); payload = {}; }
  const parsed = createSchema.safeParse(payload);
  if (!parsed.success || new Set(parsed.data.variantIds).size !== parsed.data.variantIds.length) {
    return apiError(c, 400, statusTitle(400), 'name, supported platform, and two to ten distinct variantIds are required');
  }
  const platform = canonicalPlatform(parsed.data.platform);
  if (!platform) return apiError(c, 400, statusTitle(400), `unsupported experiment platform '${parsed.data.platform}'`);
  const modelId = c.req.param('modelId');
  const saved = await withOrgContext(orgId, async (tx) => {
    const [model] = await tx.select({ id: schema.modelProfile.id }).from(schema.modelProfile)
      .where(and(eq(schema.modelProfile.id, modelId), eq(schema.modelProfile.orgId, orgId))).limit(1);
    if (!model) return null;
    const owned = await ownedVariants(tx, orgId, modelId, parsed.data.variantIds);
    if (owned.length !== parsed.data.variantIds.length) return { invalidVariants: true as const };
    const [row] = await tx.insert(schema.variantExperiment).values({
      orgId, modelId, name: parsed.data.name, platform, variantIds: parsed.data.variantIds,
    }).returning();
    if (row) await writeAudit(tx, orgId, c.get('userId') ?? 'system', 'variant.experiment.create', row.id, { modelId, platform });
    return row ?? null;
  });
  if (!saved) return apiError(c, 404, statusTitle(404), 'model not found');
  if ('invalidVariants' in saved) return apiError(c, 409, statusTitle(409), 'all variants must belong to this model');
  return c.json({ data: saved }, 201);
});

router.patch('/models/:modelId/variant-experiments/:experimentId', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  let payload: unknown;
  try { payload = await readBody(c); }
  catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'experiment body too large'); payload = {}; }
  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'status must be draft, running, or paused');
  const updated = await withOrgContext(orgId, async (tx) => {
    const [current] = await tx.select().from(schema.variantExperiment).where(and(
      eq(schema.variantExperiment.id, c.req.param('experimentId')), eq(schema.variantExperiment.modelId, c.req.param('modelId')), eq(schema.variantExperiment.orgId, orgId),
    )).limit(1).for('update');
    if (!current) return null;
    if (current.status === 'completed') return 'completed' as const;
    if (current.status === parsed.data.status) return current;
    const [row] = await tx.update(schema.variantExperiment).set({ status: parsed.data.status, updatedAt: new Date() })
      .where(and(eq(schema.variantExperiment.id, c.req.param('experimentId')), eq(schema.variantExperiment.modelId, c.req.param('modelId')), eq(schema.variantExperiment.orgId, orgId)))
      .returning();
    if (row) await writeAudit(tx, orgId, c.get('userId') ?? 'system', 'variant.experiment.status', row.id, { status: row.status });
    return row ?? null;
  });
  if (updated === 'completed') return apiError(c, 409, statusTitle(409), 'Completed experiments cannot be reopened; create a new experiment');
  if (!updated) return apiError(c, 404, statusTitle(404), 'variant experiment not found');
  return c.json({ data: updated });
});

router.post('/models/:modelId/variant-experiments/:experimentId/assign', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  let payload: unknown;
  try { payload = await readBody(c); }
  catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'assignment body too large'); payload = {}; }
  const parsed = assignmentSchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'assignmentKey is required');
  const result = await withOrgContext(orgId, async (tx) => {
    const [experiment] = await tx.select().from(schema.variantExperiment).where(and(
      eq(schema.variantExperiment.id, c.req.param('experimentId')),
      eq(schema.variantExperiment.modelId, c.req.param('modelId')),
      eq(schema.variantExperiment.orgId, orgId),
    )).limit(1).for('share');
    if (!experiment) return { status: 404 as const, error: 'variant experiment not found' };
    if (experiment.status !== 'running') return { status: 409 as const, error: `experiment is ${experiment.status}; assignment requires running status` };
    const key = stableKey(experiment.id, parsed.data.assignmentKey);
    const index = Number.parseInt(key.slice(0, 8), 16) % experiment.variantIds.length;
    const variantId = experiment.variantIds[index];
    const [inserted] = await tx.insert(schema.variantExperimentAssignment).values({ orgId, experimentId: experiment.id, variantId, assignmentKey: key })
      .onConflictDoNothing().returning();
    const assignment = inserted ?? (await tx.select().from(schema.variantExperimentAssignment).where(and(
      eq(schema.variantExperimentAssignment.orgId, orgId),
      eq(schema.variantExperimentAssignment.experimentId, experiment.id),
      eq(schema.variantExperimentAssignment.assignmentKey, key),
    )).limit(1))[0];
    return assignment ? { status: 200 as const, data: { id: assignment.id, variantId: assignment.variantId, experimentId: assignment.experimentId } } : { status: 500 as const, error: 'assignment could not be recorded' };
  });
  if (result.status !== 200) return apiError(c, result.status, statusTitle(result.status), result.error);
  return c.json({ data: result.data });
});

router.post('/models/:modelId/variant-experiments/:experimentId/outcomes', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  let payload: unknown;
  try { payload = await readBody(c); }
  catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'outcome body too large'); payload = {}; }
  const parsed = outcomeSchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'assignmentId, converted, and optional metricValue are required');
  const updated = await withOrgContext(orgId, async (tx) => {
    const [experiment] = await tx.select({ id: schema.variantExperiment.id, status: schema.variantExperiment.status }).from(schema.variantExperiment).where(and(
      eq(schema.variantExperiment.id, c.req.param('experimentId')),
      eq(schema.variantExperiment.modelId, c.req.param('modelId')),
      eq(schema.variantExperiment.orgId, orgId),
    )).limit(1).for('share');
    if (!experiment) return null;
    const [assignment] = await tx.select().from(schema.variantExperimentAssignment).where(and(
      eq(schema.variantExperimentAssignment.id, parsed.data.assignmentId),
      eq(schema.variantExperimentAssignment.orgId, orgId),
      eq(schema.variantExperimentAssignment.experimentId, c.req.param('experimentId')),
    )).limit(1).for('update');
    if (!assignment) return null;
    if (assignment.outcomeAt && (assignment.converted !== parsed.data.converted || assignment.metricValue !== (parsed.data.metricValue ?? null))) return 'conflict' as const;
    if (assignment.outcomeAt) return assignment;
    if (experiment.status === 'completed') return 'completed' as const;
    const [row] = await tx.update(schema.variantExperimentAssignment).set({ converted: parsed.data.converted, metricValue: parsed.data.metricValue ?? null, outcomeAt: new Date() })
      .where(eq(schema.variantExperimentAssignment.id, assignment.id)).returning();
    return row ?? null;
  });
  if (updated === 'conflict') return apiError(c, 409, statusTitle(409), 'assignment already has a different outcome');
  if (updated === 'completed') return apiError(c, 409, statusTitle(409), 'Completed experiments cannot accept new outcomes');
  if (!updated) return apiError(c, 404, statusTitle(404), 'assignment not found');
  return c.json({ data: updated });
});

router.post('/models/:modelId/variant-experiments/:experimentId/promote', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  let payload: unknown;
  try { payload = await readBody(c); }
  catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'promotion body too large'); payload = {}; }
  const parsed = promoteSchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'variantId is required');
  const result = await withOrgContext(orgId, async (tx) => {
    const [experiment] = await tx.select().from(schema.variantExperiment).where(and(
      eq(schema.variantExperiment.id, c.req.param('experimentId')), eq(schema.variantExperiment.modelId, c.req.param('modelId')), eq(schema.variantExperiment.orgId, orgId),
    )).limit(1).for('update');
    if (!experiment) return { status: 404 as const, error: 'variant experiment not found' };
    if (!experiment.variantIds.includes(parsed.data.variantId)) return { status: 400 as const, error: 'variant is not part of this experiment' };
    if (experiment.status === 'completed') return experiment.winnerVariantId === parsed.data.variantId
      ? { status: 200 as const, data: experiment }
      : { status: 409 as const, error: 'This experiment already has a different winner' };
    if (!['running', 'paused'].includes(experiment.status)) return { status: 409 as const, error: 'Start the experiment before selecting a winner' };
    const assignments = await tx.select({ variantId: schema.variantExperimentAssignment.variantId, outcomeAt: schema.variantExperimentAssignment.outcomeAt })
      .from(schema.variantExperimentAssignment).where(and(eq(schema.variantExperimentAssignment.experimentId, experiment.id), eq(schema.variantExperimentAssignment.orgId, orgId)));
    const observed = new Set(assignments.filter((row: { outcomeAt: Date | null }) => row.outcomeAt).map((row: { variantId: string }) => row.variantId));
    if (experiment.variantIds.some((variantId: string) => !observed.has(variantId))) return { status: 409 as const, error: 'each variant needs at least one recorded outcome before promotion' };
    const [updated] = await tx.update(schema.variantExperiment).set({ winnerVariantId: parsed.data.variantId, status: 'completed', updatedAt: new Date() })
      .where(eq(schema.variantExperiment.id, experiment.id)).returning();
    if (updated) await writeAudit(tx, orgId, c.get('userId') ?? 'system', 'variant.experiment.promote', updated.id, { winnerVariantId: updated.winnerVariantId });
    return updated ? { status: 200 as const, data: updated } : { status: 500 as const, error: 'experiment promotion failed' };
  });
  if (result.status !== 200) return apiError(c, result.status, statusTitle(result.status), result.error);
  return c.json({ data: result.data });
});

export { router as variantExperimentsRouter };
