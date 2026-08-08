// ─── Org settings (F-86, L2.8 §8) — real org_settings reads/writes ───
// GET  /api/v1/org-settings — current org settings
// PATCH /api/v1/org-settings — toggle viral_sharing / publishing_enabled

import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, apiError, statusTitle, writeAudit } from './helpers.js';

const router = new Hono<AppBindings>();

const patchSchema = z.object({
  viralSharing: z.boolean().optional(),
  publishingEnabled: z.boolean().optional(),
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
  return c.json({ success: true, data: settings });
});

// PATCH /api/v1/org-settings
router.patch('/org-settings', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const userId = c.get('userId') ?? 'system';
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid org settings body');
  const body = parsed.data;
  if (Object.keys(body).length === 0)
    return apiError(c, 400, statusTitle(400), 'nothing to update');

  const rows = await withOrgContext(orgId, async (tx) => {
    const updated = await tx
      .update(schema.orgSettings)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(schema.orgSettings.orgId, orgId))
      .returning();
    if (updated.length === 0) return [] as typeof updated;
    await writeAudit(tx, orgId, userId, 'org.settings.update', orgId, { ...body });
    return updated;
  });
  if (rows.length === 0) return apiError(c, 404, statusTitle(404), 'org settings not found');
  return c.json({ success: true, data: rows[0] });
});

export { router as orgSettingsRouter };
