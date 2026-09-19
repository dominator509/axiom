import { Hono } from 'hono';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { enqueueJob } from '@axiom/worker';
import type { AppBindings } from '../index.js';
import { modelAccessCondition } from '../model-access.js';
import { apiError, requireOrg, statusTitle, withOrgContext } from './helpers.js';

const router = new Hono<AppBindings>();

function allowedReadRole(role: string | null | undefined): boolean {
  return ['owner', 'manager', 'operator', 'analyst', 'model'].includes(role ?? '');
}

router.get('/models/:modelId/fanvue/analytics', async (c) => {
  const orgId = requireOrg(c);
  const role = c.get('role');
  const userId = c.get('userId');
  const modelId = c.req.param('modelId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!allowedReadRole(role)) return apiError(c, 403, statusTitle(403), 'Fanvue analytics are not available to this role');

  const data = await withOrgContext(orgId, async (tx) => {
    const scope = modelAccessCondition(role, orgId, userId, schema.fanvueMetric.modelId);
    const metrics = await tx.select({
      id: schema.fanvueMetric.id,
      ts: schema.fanvueMetric.ts,
      subscribers: schema.fanvueMetric.subscribers,
      earningsUsd: schema.fanvueMetric.earningsUsd,
      messages: schema.fanvueMetric.messages,
      tips: schema.fanvueMetric.tips,
      tipEarningsUsd: schema.fanvueMetric.tipEarningsUsd,
      subscriberEventsNew: schema.fanvueMetric.subscriberEventsNew,
      subscriberEventsCancelled: schema.fanvueMetric.subscriberEventsCancelled,
      unreadMessages: schema.fanvueMetric.unreadMessages,
      topSpenderCount: schema.fanvueMetric.topSpenderCount,
      windowStart: schema.fanvueMetric.windowStart,
      windowEnd: schema.fanvueMetric.windowEnd,
    }).from(schema.fanvueMetric)
      .where(and(eq(schema.fanvueMetric.orgId, orgId), eq(schema.fanvueMetric.modelId, modelId), scope))
      .orderBy(desc(schema.fanvueMetric.ts)).limit(1);
    const contacts = await tx.select({
      id: schema.fanCrmContact.id,
      displayName: schema.fanCrmContact.displayName,
      tier: schema.fanCrmContact.tier,
      lifetimeValueUsd: schema.fanCrmContact.lifetimeValueUsd,
      lastActiveAt: schema.fanCrmContact.lastActiveAt,
    }).from(schema.fanCrmContact)
      .where(and(
        eq(schema.fanCrmContact.orgId, orgId),
        eq(schema.fanCrmContact.modelId, modelId),
        eq(schema.fanCrmContact.platform, 'fanvue'),
        inArray(schema.fanCrmContact.tier, ['whale', 'loyal', 'expired', 'new']),
        modelAccessCondition(role, orgId, userId, schema.fanCrmContact.modelId),
      ))
      .orderBy(desc(schema.fanCrmContact.lifetimeValueUsd)).limit(50);
    return { metric: metrics[0] ?? null, contacts };
  });
  return c.json({ data });
});

router.post('/models/:modelId/fanvue/analytics/sync', async (c) => {
  const orgId = requireOrg(c);
  const role = c.get('role');
  const userId = c.get('userId');
  const modelId = c.req.param('modelId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!['owner', 'manager', 'operator'].includes(role ?? '')) {
    return apiError(c, 403, statusTitle(403), 'Fanvue analytics sync requires an operator role');
  }
  let body: { connectionId?: string } = {};
  try { body = await c.req.json(); } catch { /* empty body selects the model-bound account */ }
  if (body.connectionId !== undefined && !/^[0-9a-f-]{36}$/i.test(body.connectionId)) {
    return apiError(c, 400, statusTitle(400), 'connectionId must be a valid identifier');
  }
  const result = await withOrgContext(orgId, async (tx) => {
    const models = await tx.select({ id: schema.modelProfile.id }).from(schema.modelProfile)
      .where(and(eq(schema.modelProfile.id, modelId), eq(schema.modelProfile.orgId, orgId), modelAccessCondition(role, orgId, userId, schema.modelProfile.id))).limit(1);
    if (!models.length) return { error: 'model unavailable' as const };
    const job = await enqueueJob(tx, {
      orgId,
      queue: 'metrics',
      kind: 'fanvue.analytics.sync',
      payload: { modelId, ...(body.connectionId ? { connectionId: body.connectionId } : {}) },
      dedupeParts: ['fanvue.analytics.sync', modelId, body.connectionId ?? 'model-bound', Math.floor(Date.now() / (15 * 60_000))],
    });
    return { jobId: job?.id ?? null, deduplicated: !job };
  });
  if ('error' in result) return apiError(c, 404, statusTitle(404), result.error ?? 'model unavailable');
  return c.json({ data: result }, 202);
});

export { router as fanvueAnalyticsRouter };
