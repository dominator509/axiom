// ─── Editable playbook guidelines (F-54/F-55/F-56) ─────────────────────────

import { Hono } from 'hono';
import { z } from 'zod';
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import { asPlatform } from '@axiom/worker';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import type { Context } from 'hono';
import { withOrgContext, requireOrg, apiError, statusTitle, writeAudit } from './helpers.js';
import { readBoundedJson, RequestBodyTooLargeError } from '../webhook-body.js';
import { modelAccessCondition } from '../model-access.js';

const router = new Hono<AppBindings>();
const guidelineSchema = z.object({ expectedRevision: z.number().int().min(0).max(2147483646), platform: z.string().trim().min(1).max(50), optimalTimes: z.array(z.string().trim().min(1).max(30)).max(14), cadencePerWeek: z.number().int().min(0).max(100), upsellStrategy: z.string().trim().max(2_000) }).strict();

async function readBody(c: Context<AppBindings>): Promise<unknown> {
  try { return await readBoundedJson(c.req.raw, 64 * 1024); }
  catch (error) { if (error instanceof RequestBodyTooLargeError) throw error; return {}; }
}

router.get('/models/:modelId/playbook-guidelines', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  if (c.req.query('history') === 'true') {
    const platform = c.req.query('platform') ?? '';
    try { asPlatform(platform); } catch { return apiError(c, 400, statusTitle(400), 'history requires a supported platform'); }
    const before = c.req.query('before');
    if (before !== undefined && (!/^[1-9]\d*$/.test(before) || !Number.isSafeInteger(Number(before))))
      return apiError(c, 400, statusTitle(400), 'invalid history cursor');
    const rows = await withOrgContext(orgId, tx => tx.select().from(schema.playbookGuidelineRevision).where(and(
      eq(schema.playbookGuidelineRevision.orgId, orgId), eq(schema.playbookGuidelineRevision.modelId, c.req.param('modelId')),
      eq(schema.playbookGuidelineRevision.platform, platform),
      modelAccessCondition(c.get('role'), orgId, c.get('userId'), schema.playbookGuidelineRevision.modelId),
      before ? lt(schema.playbookGuidelineRevision.revision, Number(before)) : undefined,
    )).orderBy(desc(schema.playbookGuidelineRevision.revision)).limit(51));
    return c.json({ data: rows.slice(0, 50), meta: { next_cursor: rows.length > 50 ? String(rows[49].revision) : null } });
  }
  const rows = await withOrgContext(orgId, (tx) => tx.select().from(schema.playbookGuideline).where(and(eq(schema.playbookGuideline.orgId, orgId), eq(schema.playbookGuideline.modelId, c.req.param('modelId')), modelAccessCondition(c.get('role'), orgId, c.get('userId'), schema.playbookGuideline.modelId))).orderBy(asc(schema.playbookGuideline.platform)));
  return c.json({ data: rows });
});

router.put('/models/:modelId/playbook-guidelines', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  let payload: unknown;
  try { payload = await readBody(c); } catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'guideline body too large'); payload = {}; }
  const parsed = guidelineSchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid playbook guideline');
  try { asPlatform(parsed.data.platform); } catch { return apiError(c, 400, statusTitle(400), `unsupported guideline platform '${parsed.data.platform}'`); }
  const modelId = c.req.param('modelId');
  const saved = await withOrgContext(orgId, async (tx) => {
    const [model] = await tx.select({ id: schema.modelProfile.id }).from(schema.modelProfile).where(and(eq(schema.modelProfile.id, modelId), eq(schema.modelProfile.orgId, orgId))).limit(1).for('update');
    if (!model) return null;
    const [previous] = await tx.select().from(schema.playbookGuideline).where(and(eq(schema.playbookGuideline.orgId, orgId), eq(schema.playbookGuideline.modelId, modelId), eq(schema.playbookGuideline.platform, parsed.data.platform))).limit(1);
    if ((previous?.revision ?? 0) !== parsed.data.expectedRevision) return 'conflict' as const;
    const snapshot = async (value: typeof schema.playbookGuideline.$inferSelect) => {
      await tx.insert(schema.playbookGuidelineRevision).values({ guidelineId: value.id, orgId, modelId,
        platform: value.platform, revision: value.revision, optimalTimes: value.optimalTimes,
        cadencePerWeek: value.cadencePerWeek, upsellStrategy: value.upsellStrategy,
      }).onConflictDoNothing({ target: [schema.playbookGuidelineRevision.guidelineId, schema.playbookGuidelineRevision.revision] });
    };
    // Capture the current pre-upgrade revision on its first subsequent edit.
    if (previous) await snapshot(previous);
    const [row] = await tx.insert(schema.playbookGuideline).values({ orgId, modelId, ...parsed.data }).onConflictDoUpdate({ target: [schema.playbookGuideline.modelId, schema.playbookGuideline.platform], set: { optimalTimes: parsed.data.optimalTimes, cadencePerWeek: parsed.data.cadencePerWeek, upsellStrategy: parsed.data.upsellStrategy, revision: sql`${schema.playbookGuideline.revision} + 1`, updatedAt: new Date() } }).returning();
    if (row) {
      await snapshot(row);
      await writeAudit(tx, orgId, c.get('userId') ?? 'system', 'playbook.guideline.save', row.id, { modelId, platform: row.platform, revision: row.revision });
    }
    return row ?? null;
  });
  if (!saved) return apiError(c, 404, statusTitle(404), 'model not found');
  if (saved === 'conflict') return apiError(c, 409, statusTitle(409), 'Guideline changed since you opened it. Reload the page and review the latest revision before saving.');
  return c.json({ data: saved });
});

export { router as playbookGuidelinesRouter };
