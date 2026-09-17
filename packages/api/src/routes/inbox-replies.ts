import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { modelAccessCondition } from '../model-access.js';
import { dispatchReply, cancelReply } from '../reply-dispatch.js';
import { boundedJsonValidator } from '../bounded-json-validator.js';
import { apiError, requireOrg, statusTitle, withOrgContext, writeAudit } from './helpers.js';

const router = new Hono<AppBindings>();
const uuid = z.string().uuid();
const bodySchema = z.object({ connectionId: uuid, counterpartUuid: uuid, intentKey: uuid,
  body: z.string().min(1).max(5000).refine(text => text.trim().length > 0) }).strict();
const readRoles = ['owner', 'manager', 'operator', 'model', 'chatter'];
const writeRoles = ['owner', 'manager', 'operator', 'chatter'];

router.post('/models/:modelId/inbox/replies/:replyId/cancel', boundedJsonValidator('json', z.object({ confirm: z.literal(true) }).strict()), async c => {
  c.header('Cache-Control', 'private, no-store');
  const orgId = requireOrg(c), userId = c.get('userId'), role = c.get('role');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!writeRoles.includes(role ?? '')) return apiError(c, 403, statusTitle(403), 'reply cancellation unavailable');
  const modelId = c.req.param('modelId'), replyId = c.req.param('replyId');
  if (!uuid.safeParse(modelId).success || !uuid.safeParse(replyId).success) return apiError(c, 400, statusTitle(400), 'valid model and reply required');
  const result = await cancelReply({ orgId, modelId, userId, replyId }).catch(() => null);
  if (!result) return apiError(c, 503, statusTitle(503), 'cancellation not confirmed; load reply history');
  if (result.outcome === 'cancelled') return c.json({ data: { replyId, state: 'cancelled' } });
  if (result.outcome === 'denied') return apiError(c, 404, statusTitle(404), 'reply ownership, assignment or active shift unavailable');
  return apiError(c, 409, statusTitle(409), 'dispatch already started; cancellation cannot recall a message');
});

router.post('/models/:modelId/inbox/replies/:replyId/send', boundedJsonValidator('json', z.object({ confirm: z.literal(true) }).strict()), async c => {
  c.header('Cache-Control', 'private, no-store');
  const orgId = requireOrg(c), userId = c.get('userId'), role = c.get('role');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!writeRoles.includes(role ?? '')) return apiError(c, 403, statusTitle(403), 'reply sending unavailable');
  const modelId = c.req.param('modelId'), replyId = c.req.param('replyId');
  if (!uuid.safeParse(modelId).success || !uuid.safeParse(replyId).success) return apiError(c, 400, statusTitle(400), 'valid model and reply required');
  try {
    const result = await dispatchReply({ orgId, modelId, userId, replyId });
    if (result.outcome === 'finished') return c.json({ data: { replyId: result.replyId, state: result.state } });
    if (result.outcome === 'denied') return apiError(c, 404, statusTitle(404), 'reply ownership, assignment or active shift unavailable');
    if (result.outcome === 'halted') return apiError(c, 409, statusTitle(409), 'workspace safety switch is halted');
    if (result.outcome === 'consent-required') return apiError(c, 409, statusTitle(409), 'valid model consent records required');
    if (result.outcome === 'account-unavailable') return apiError(c, 409, statusTitle(409), 'account changed or unavailable; check the connection');
    if (result.outcome === 'already-dispatched') return apiError(c, 409, statusTitle(409), 'reply already attempted; load history, do not create a duplicate');
    return apiError(c, 503, statusTitle(503), 'delivery not confirmed; load reply history before any further action');
  } catch {
    return apiError(c, 503, statusTitle(503), 'delivery not confirmed; load reply history before any further action');
  }
});

router.post('/models/:modelId/inbox/replies', boundedJsonValidator('json', bodySchema), async c => {
  c.header('Cache-Control', 'private, no-store');
  const orgId = requireOrg(c), userId = c.get('userId'), role = c.get('role'), modelId = c.req.param('modelId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!writeRoles.includes(role ?? '')) return apiError(c, 403, statusTitle(403), 'reply creation unavailable');
  if (!uuid.safeParse(modelId).success) return apiError(c, 400, statusTitle(400), 'valid model required');
  const body = c.req.valid('json');
  const result = await withOrgContext(orgId, async tx => {
    const [account] = await tx.select({ id: schema.platformConnection.id }).from(schema.platformConnection)
      .where(and(eq(schema.platformConnection.id, body.connectionId), eq(schema.platformConnection.orgId, orgId),
        eq(schema.platformConnection.modelId, modelId), eq(schema.platformConnection.platform, 'fanvue'),
        inArray(schema.platformConnection.status, ['active', 'connected']),
        modelAccessCondition(role, orgId, userId, schema.platformConnection.modelId))).limit(1);
    if (!account) return null;
    const [created] = await tx.insert(schema.inboxReplyIntent).values({ ...body, orgId, modelId, actorUserId: userId })
      .onConflictDoNothing({ target: [schema.inboxReplyIntent.orgId, schema.inboxReplyIntent.actorUserId, schema.inboxReplyIntent.intentKey] }).returning();
    const [existing] = created ? [] : await tx.select().from(schema.inboxReplyIntent)
      .where(and(eq(schema.inboxReplyIntent.orgId, orgId), eq(schema.inboxReplyIntent.actorUserId, userId), eq(schema.inboxReplyIntent.intentKey, body.intentKey))).limit(1);
    const record = created ?? existing;
    if (!record || record.modelId !== modelId || record.connectionId !== body.connectionId || record.counterpartUuid !== body.counterpartUuid || record.body !== body.body)
      return 'conflict' as const;
    if (created) await writeAudit(tx, orgId, userId, 'inbox.reply.prepare', record.id, { modelId, connectionId: body.connectionId });
    // No enqueue, provider call or outbound timeline entry: pending is not sent.
    return { record, created: Boolean(created) };
  });
  if (!result) return apiError(c, 404, statusTitle(404), 'account assignment or active shift unavailable');
  if (result === 'conflict') return apiError(c, 409, statusTitle(409), 'intent key already belongs to different reply content');
  return c.json({ data: result.record }, result.created ? 201 : 200);
});

router.get('/models/:modelId/inbox/replies', async c => {
  c.header('Cache-Control', 'private, no-store');
  const orgId = requireOrg(c), userId = c.get('userId'), role = c.get('role'), modelId = c.req.param('modelId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!readRoles.includes(role ?? '')) return apiError(c, 403, statusTitle(403), 'reply history unavailable');
  const parsed = z.object({ modelId: uuid, connectionId: uuid, counterpartUuid: uuid, cursor: uuid.optional() })
    .safeParse({ modelId, connectionId: c.req.query('connectionId'), counterpartUuid: c.req.query('counterpartUuid'), cursor: c.req.query('cursor') });
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'valid conversation and cursor required');
  const { connectionId, counterpartUuid, cursor } = parsed.data;
  const result = await withOrgContext(orgId, async tx => {
    const [model] = await tx.select({ id: schema.modelProfile.id }).from(schema.modelProfile)
      .where(and(eq(schema.modelProfile.orgId, orgId), eq(schema.modelProfile.id, modelId), modelAccessCondition(role, orgId, userId))).limit(1);
    if (!model) return null;
    const scope = and(eq(schema.inboxReplyIntent.orgId, orgId), eq(schema.inboxReplyIntent.modelId, modelId),
      eq(schema.inboxReplyIntent.connectionId, connectionId), eq(schema.inboxReplyIntent.counterpartUuid, counterpartUuid),
      modelAccessCondition(role, orgId, userId, schema.inboxReplyIntent.modelId));
    const [before] = cursor ? await tx.select().from(schema.inboxReplyIntent).where(and(scope, eq(schema.inboxReplyIntent.id, cursor))).limit(1) : [];
    if (cursor && !before) return 'cursor' as const;
    const rows = await tx.select().from(schema.inboxReplyIntent).where(and(scope, before ? or(
      lt(schema.inboxReplyIntent.createdAt, before.createdAt), and(eq(schema.inboxReplyIntent.createdAt, before.createdAt), lt(schema.inboxReplyIntent.id, before.id))) : undefined))
      .orderBy(desc(schema.inboxReplyIntent.createdAt), desc(schema.inboxReplyIntent.id)).limit(51);
    return { data: rows.slice(0, 50), meta: { next_cursor: rows.length > 50 ? rows[49].id : null } };
  });
  if (!result) return apiError(c, 404, statusTitle(404), 'assigned model or active shift unavailable');
  if (result === 'cursor') return apiError(c, 400, statusTitle(400), 'invalid reply cursor');
  return c.json(result);
});

export { router as inboxRepliesRouter };
