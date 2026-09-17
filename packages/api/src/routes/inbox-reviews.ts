import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { modelAccessCondition } from '../model-access.js';
import { boundedJsonValidator } from '../bounded-json-validator.js';
import { apiError, requireOrg, statusTitle, withOrgContext, writeAudit } from './helpers.js';

const router = new Hono<AppBindings>();
const uuid = z.string().uuid();
const bodySchema = z.object({ intentKey: uuid, conclusion: z.enum(['observed_sent', 'unresolved']),
  observedMessageUuid: uuid.nullable().default(null), note: z.string().min(1).max(2000).refine(text => text.trim().length > 0),
}).strict().refine(value => (value.conclusion === 'observed_sent') === (value.observedMessageUuid !== null));
const writers = ['owner', 'manager', 'operator', 'chatter'];
const path = '/models/:modelId/inbox/replies/:replyId/reviews';

router.post(path, boundedJsonValidator('json', bodySchema), async c => {
  c.header('Cache-Control', 'private, no-store');
  const orgId = requireOrg(c), userId = c.get('userId'), role = c.get('role');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!writers.includes(role ?? '')) return apiError(c, 403, statusTitle(403), 'review recording unavailable');
  const modelId = c.req.param('modelId'), replyId = c.req.param('replyId');
  if (!uuid.safeParse(modelId).success || !uuid.safeParse(replyId).success) return apiError(c, 400, statusTitle(400), 'valid model and reply required');
  const body = c.req.valid('json');
  const result = await withOrgContext(orgId, async tx => {
    await tx.execute(sql`SELECT id FROM org WHERE id = ${orgId} FOR UPDATE`);
    const [actor] = await tx.select().from(schema.authUser).where(and(eq(schema.authUser.orgId, orgId), eq(schema.authUser.id, userId))).limit(1);
    if (!actor || !writers.includes(actor.role)) return null;
    const [reply] = await tx.select().from(schema.inboxReplyIntent).where(and(eq(schema.inboxReplyIntent.orgId, orgId),
      eq(schema.inboxReplyIntent.modelId, modelId), eq(schema.inboxReplyIntent.id, replyId), modelAccessCondition(actor.role, orgId, userId, schema.inboxReplyIntent.modelId))).limit(1);
    if (!reply) return null;
    // Read existing intent before the state check: an exact retry stays valid if
    // a late provider receipt settled the original attempt after the review.
    const [existing] = await tx.select().from(schema.inboxReplyReview).where(and(eq(schema.inboxReplyReview.orgId, orgId),
      eq(schema.inboxReplyReview.actorUserId, userId), eq(schema.inboxReplyReview.intentKey, body.intentKey))).limit(1);
    if (existing) return existing.modelId === modelId && existing.replyId === replyId && existing.conclusion === body.conclusion
      && existing.observedMessageUuid === body.observedMessageUuid && existing.note === body.note
      ? { record: existing, created: false } : 'conflict' as const;
    if (!['dispatching', 'uncertain'].includes(reply.state)) return 'settled' as const;
    const [record] = await tx.insert(schema.inboxReplyReview).values({ ...body, orgId, modelId, replyId, actorUserId: userId }).returning();
    await writeAudit(tx, orgId, userId, 'inbox.reply.review', record.id, { modelId, replyId, conclusion: body.conclusion, evidenceSource: 'operator_review' });
    return { record, created: true };
  });
  if (!result) return apiError(c, 404, statusTitle(404), 'reply assignment or active shift unavailable');
  if (result === 'conflict') return apiError(c, 409, statusTitle(409), 'review intent key already used for different evidence');
  if (result === 'settled') return apiError(c, 409, statusTitle(409), 'only unresolved dispatch attempts accept new reviews');
  return c.json({ data: result.record }, result.created ? 201 : 200);
});

router.get(path, async c => {
  c.header('Cache-Control', 'private, no-store');
  const orgId = requireOrg(c), userId = c.get('userId'), role = c.get('role');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (![...writers, 'model'].includes(role ?? '')) return apiError(c, 403, statusTitle(403), 'review history unavailable');
  const parsed = z.object({ modelId: uuid, replyId: uuid, cursor: uuid.optional() }).safeParse({ ...c.req.param(), cursor: c.req.query('cursor') });
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'valid model, reply and cursor required');
  const { modelId, replyId, cursor } = parsed.data;
  const result = await withOrgContext(orgId, async tx => {
    const [reply] = await tx.select({ id: schema.inboxReplyIntent.id }).from(schema.inboxReplyIntent).where(and(
      eq(schema.inboxReplyIntent.orgId, orgId), eq(schema.inboxReplyIntent.modelId, modelId), eq(schema.inboxReplyIntent.id, replyId),
      modelAccessCondition(role, orgId, userId, schema.inboxReplyIntent.modelId))).limit(1);
    if (!reply) return null;
    const scope = and(eq(schema.inboxReplyReview.orgId, orgId), eq(schema.inboxReplyReview.modelId, modelId), eq(schema.inboxReplyReview.replyId, replyId));
    const [before] = cursor ? await tx.select().from(schema.inboxReplyReview).where(and(scope, eq(schema.inboxReplyReview.id, cursor))).limit(1) : [];
    if (cursor && !before) return 'cursor' as const;
    const rows = await tx.select().from(schema.inboxReplyReview).where(and(scope, before ? or(lt(schema.inboxReplyReview.createdAt, before.createdAt),
      and(eq(schema.inboxReplyReview.createdAt, before.createdAt), lt(schema.inboxReplyReview.id, before.id))) : undefined))
      .orderBy(desc(schema.inboxReplyReview.createdAt), desc(schema.inboxReplyReview.id)).limit(51);
    return { data: rows.slice(0, 50), meta: { next_cursor: rows.length > 50 ? rows[49].id : null } };
  });
  if (!result) return apiError(c, 404, statusTitle(404), 'reply assignment or active shift unavailable');
  if (result === 'cursor') return apiError(c, 400, statusTitle(400), 'invalid review cursor');
  return c.json(result);
});
export { router as inboxReviewsRouter };
