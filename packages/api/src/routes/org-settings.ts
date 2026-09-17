// ─── Org settings (F-86, L2.8 §8) — real org_settings reads/writes ───
// GET  /api/v1/org-settings — current org settings
// PATCH /api/v1/org-settings — toggle viral_sharing / publishing_enabled

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { enqueueWeeklyDigest } from '@axiom/worker';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, apiError, statusTitle, writeAudit } from './helpers.js';
import { readBoundedJson, RequestBodyTooLargeError } from '../webhook-body.js';

const router = new Hono<AppBindings>();

const patchSchema = z.object({
  viralSharing: z.boolean().optional(),
  publishingEnabled: z.boolean().optional(),
  weeklyDigestEnabled: z.boolean().optional(),
});

// GET /api/v1/org-settings
router.get('/org-settings', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');

  const rows = await withOrgContext(orgId, (tx) =>
    tx.select().from(schema.orgSettings).where(eq(schema.orgSettings.orgId, orgId)).limit(1),
  );
  const settings = rows[0];
  if (!settings) return apiError(c, 404, statusTitle(404), 'org settings not found');
  return c.json({ success: true, data: { ...settings, weeklyDigestEnabled: !!settings.weeklyDigestScheduleId } });
});

// PATCH /api/v1/org-settings
router.patch('/org-settings', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const userId = c.get('userId') ?? 'system';
  let payload: unknown = {};
  try {
    payload = await readBoundedJson(c.req.raw);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return apiError(c, 413, statusTitle(413), 'org settings body too large');
    }
  }
  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid org settings body');
  const body = parsed.data;
  if (Object.keys(body).length === 0)
    return apiError(c, 400, statusTitle(400), 'nothing to update');

  const rows = await withOrgContext(orgId, async (tx) => {
    const { weeklyDigestEnabled, ...ordinarySettings } = body;
    let scheduleId: string | null | undefined;
    if (weeklyDigestEnabled !== undefined) {
      const [current] = await tx.select().from(schema.orgSettings)
        .where(eq(schema.orgSettings.orgId, orgId)).limit(1).for('update');
      if (!current) return [];
      scheduleId = weeklyDigestEnabled ? current.weeklyDigestScheduleId ?? randomUUID() : null;
    }
    const updated = await tx
      .update(schema.orgSettings)
      .set({ ...ordinarySettings, ...(scheduleId !== undefined ? { weeklyDigestScheduleId: scheduleId } : {}), updatedAt: new Date() })
      .where(eq(schema.orgSettings.orgId, orgId))
      .returning();
    if (updated.length === 0) return [] as typeof updated;
    if (scheduleId) await enqueueWeeklyDigest(tx, orgId, scheduleId);
    await writeAudit(tx, orgId, userId, 'org.settings.update', orgId, { ...body });
    return updated;
  });
  if (rows.length === 0) return apiError(c, 404, statusTitle(404), 'org settings not found');
  return c.json({ success: true, data: { ...rows[0], weeklyDigestEnabled: !!rows[0].weeklyDigestScheduleId } });
});

export { router as orgSettingsRouter };
