import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { inboxForConnection } from '@axiom/worker';
import type { AppBindings } from '../index.js';
import { modelAccessCondition } from '../model-access.js';
import { apiError, requireOrg, statusTitle, withOrgContext } from './helpers.js';

const router = new Hono<AppBindings>();
const input = z.object({
  modelId: z.string().uuid(), connectionId: z.string().uuid().optional(), userUuid: z.string().uuid().optional(),
  page: z.string().regex(/^[1-9][0-9]{0,5}$/).default('1').transform(Number),
}).refine(value => !value.userUuid || Boolean(value.connectionId));

router.get('/models/:modelId/inbox', async c => {
  c.header('Cache-Control', 'private, no-store');
  const orgId = requireOrg(c), userId = c.get('userId'), role = c.get('role');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!['owner', 'manager', 'operator', 'model', 'chatter'].includes(role ?? ''))
    return apiError(c, 403, statusTitle(403), 'inbox is not available to this role');
  const parsed = input.safeParse({ modelId: c.req.param('modelId'), connectionId: c.req.query('connectionId'),
    userUuid: c.req.query('userUuid'), page: c.req.query('page') });
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'valid model, account, conversation and page required');
  const { modelId, connectionId, userUuid, page } = parsed.data;
  const accessible = () => withOrgContext(orgId, tx => tx.select({ id: schema.modelProfile.id })
    .from(schema.modelProfile).where(and(eq(schema.modelProfile.id, modelId), eq(schema.modelProfile.orgId, orgId),
      modelAccessCondition(role, orgId, userId))).limit(1));
  if (!(await accessible()).length) return apiError(c, 404, statusTitle(404), 'assigned model or active shift unavailable');
  const connectionScope = and(eq(schema.platformConnection.orgId, orgId), eq(schema.platformConnection.modelId, modelId),
    eq(schema.platformConnection.platform, 'fanvue'), inArray(schema.platformConnection.status, ['connected', 'active']),
    modelAccessCondition(role, orgId, userId, schema.platformConnection.modelId));
  if (!connectionId) {
    const accounts = await withOrgContext(orgId, tx => tx.select({ id: schema.platformConnection.id, displayName: schema.platformConnection.displayName })
      .from(schema.platformConnection).where(connectionScope).orderBy(schema.platformConnection.id).limit(101));
    if (accounts.length > 100) return apiError(c, 409, statusTitle(409), 'too many connected inbox accounts');
    return c.json({ data: { accounts } });
  }
  const rows = await withOrgContext(orgId, tx => tx.select().from(schema.platformConnection)
    .where(and(connectionScope, eq(schema.platformConnection.id, connectionId))).limit(1));
  if (!rows.length) return apiError(c, 404, statusTitle(404), 'inbox account unavailable');
  try {
    // Counterpart is interpreted only within this exact connected creator account.
    const inbox = await inboxForConnection(rows[0], page, userUuid);
    if (!(await accessible()).length) return apiError(c, 404, statusTitle(404), 'assigned model or active shift unavailable');
    const stillConnected = await withOrgContext(orgId, tx => tx.select({ id: schema.platformConnection.id })
      .from(schema.platformConnection).where(and(connectionScope, eq(schema.platformConnection.id, connectionId))).limit(1));
    if (!stillConnected.length) return apiError(c, 404, statusTitle(404), 'inbox account unavailable');
    return c.json({ data: { connectionId, userUuid: userUuid ?? null, observedAt: new Date().toISOString(), inbox } });
  } catch {
    return apiError(c, 502, statusTitle(502), 'Inbox could not be read. Check the Fanvue connection, chat permission and model network before retrying.');
  }
});

export { router as inboxRouter };
