// ─── Global kill switch (F-12, LBI-11) — DB-backed org_settings ───
// Replaces the in-memory stub: the flag now persists in org_settings,
// every flip is audited (LBI-08), and the dashboard reads real state.

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, writeAudit, apiError, statusTitle } from './helpers.js';

const router = new Hono<AppBindings>();

const killSwitchSchema = z.object({
  reason: z.string().max(500).optional(),
});

async function getSettings(tx: any, orgId: string) {
  const rows = await tx
    .select()
    .from(schema.orgSettings)
    .where(eq(schema.orgSettings.orgId, orgId))
    .limit(1);
  if (rows.length > 0) return rows[0];
  const [row] = await tx
    .insert(schema.orgSettings)
    .values({ orgId, publishingEnabled: true })
    .onConflictDoNothing()
    .returning();
  return (
    row ?? (await tx.select().from(schema.orgSettings).where(eq(schema.orgSettings.orgId, orgId)).limit(1))[0]
  );
}

// GET /api/v1/killswitch — status
router.get('/killswitch', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const settings = await withOrgContext(orgId, (tx) => getSettings(tx, orgId));
  return c.json({
    data: {
      enabled: !settings.publishingEnabled,
      reason: settings.killSwitchReason ?? '',
      startedAt: settings.killSwitchAt,
      updatedAt: settings.updatedAt,
    },
  });
});

// POST /api/v1/killswitch/enable — flip the global kill switch (LBI-11)
router.post('/killswitch/enable', zValidator('json', killSwitchSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  const updated = await withOrgContext(orgId, async (tx) => {
    const [row] = await tx
      .update(schema.orgSettings)
      .set({
        publishingEnabled: false,
        killSwitchReason: body.reason ?? 'Emergency shutdown triggered',
        killSwitchActor: userId,
        killSwitchAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.orgSettings.orgId, orgId))
      .returning();
    await writeAudit(tx, orgId, userId, 'killswitch.enable', orgId, {
      reason: body.reason ?? '',
    });
    return row;
  });
  return c.json({ data: { enabled: true, ...updated } });
});

// POST /api/v1/killswitch/disable — restore publishing
router.post('/killswitch/disable', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const userId = c.get('userId') ?? 'system';

  const updated = await withOrgContext(orgId, async (tx) => {
    const [row] = await tx
      .update(schema.orgSettings)
      .set({
        publishingEnabled: true,
        killSwitchReason: null,
        killSwitchAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.orgSettings.orgId, orgId))
      .returning();
    await writeAudit(tx, orgId, userId, 'killswitch.disable', orgId, {});
    return row;
  });
  return c.json({ data: { enabled: false, ...updated } });
});

// L3.0 contract alias: POST /api/v1/kill-switch {scope: org|model, model_id?}
router.post('/kill-switch', zValidator('json', killSwitchSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  // Org-scope kill switch per L3.0. Model-scope would additionally flip the
  // model's egress config; the plane already supports per-model binds, so
  // the dashboard only exposes the org-wide switch (LBI-11).
  const updated = await withOrgContext(orgId, async (tx) => {
    const [row] = await tx
      .update(schema.orgSettings)
      .set({
        publishingEnabled: false,
        killSwitchReason: body.reason ?? 'Emergency shutdown triggered',
        killSwitchActor: userId,
        killSwitchAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.orgSettings.orgId, orgId))
      .returning();
    await writeAudit(tx, orgId, userId, 'kill-switch.org', orgId, {
      reason: body.reason ?? '',
      scope: 'org',
    });
    return row;
  });
  return c.json({ data: { enabled: true, ...updated } });
});

export { router as killswitchRouter };
