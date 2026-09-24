import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { earningsForConnection } from '@axiom/worker';
import type { AppBindings } from '../index.js';
import { modelAccessCondition } from '../model-access.js';
import { apiError, requireOrg, statusTitle, withOrgContext } from './helpers.js';

const router = new Hono<AppBindings>();
const uuid = z.string().uuid();

router.get('/models/:modelId/earnings', async c => {
  c.header('Cache-Control', 'private, no-store');
  const orgId = requireOrg(c), userId = c.get('userId'), role = c.get('role');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!['owner', 'manager', 'model'].includes(role ?? ''))
    return apiError(c, 403, statusTitle(403), 'earnings are not available to this role');
  const modelId = c.req.param('modelId'), connectionId = c.req.query('connectionId');
  if (!uuid.safeParse(modelId).success || (connectionId !== undefined && !uuid.safeParse(connectionId).success))
    return apiError(c, 400, statusTitle(400), 'valid model and connection identifiers required');

  const accessible = () => withOrgContext(orgId, tx => tx.select({ id: schema.modelProfile.id })
    .from(schema.modelProfile).where(and(eq(schema.modelProfile.id, modelId),
      eq(schema.modelProfile.orgId, orgId), modelAccessCondition(role, orgId, userId))).limit(1));
  if (!(await accessible()).length) return apiError(c, 404, statusTitle(404), 'model unavailable');

  const connectionScope = and(eq(schema.platformConnection.orgId, orgId),
    eq(schema.platformConnection.modelId, modelId), eq(schema.platformConnection.platform, 'fanvue'),
    inArray(schema.platformConnection.status, ['connected', 'active']),
    modelAccessCondition(role, orgId, userId, schema.platformConnection.modelId));
  // Account discovery never decrypts credentials or makes a provider request.
  if (!connectionId) {
    const accounts = await withOrgContext(orgId, tx => tx.select({
      id: schema.platformConnection.id, displayName: schema.platformConnection.displayName,
    }).from(schema.platformConnection).where(connectionScope).orderBy(schema.platformConnection.id).limit(101));
    if (accounts.length > 100) return apiError(c, 409, statusTitle(409), 'too many connected earnings accounts');
    return c.json({ data: { accounts } });
  }
  const rows = await withOrgContext(orgId, tx => tx.select().from(schema.platformConnection)
    .where(and(connectionScope, eq(schema.platformConnection.id, connectionId))).limit(1));
  if (!rows.length) return apiError(c, 404, statusTitle(404), 'earnings account unavailable');
  try {
    const summary = await earningsForConnection(rows[0]);
    // A slow provider must not disclose data after an assignment or account was revoked.
    if (!(await accessible()).length) return apiError(c, 404, statusTitle(404), 'model unavailable');
    const stillConnected = await withOrgContext(orgId, tx => tx.select({ id: schema.platformConnection.id })
      .from(schema.platformConnection).where(and(connectionScope, eq(schema.platformConnection.id, connectionId))).limit(1));
    if (!stillConnected.length) return apiError(c, 404, statusTitle(404), 'earnings account unavailable');
    return c.json({ data: { connectionId, currency: 'USD', unit: 'cents',
      observedAt: new Date().toISOString(), summary } });
  } catch {
    return apiError(c, 502, statusTitle(502),
      'Earnings could not be read. Check the account connection, insights permission and model network before retrying.');
  }
});

export { router as earningsRouter };
