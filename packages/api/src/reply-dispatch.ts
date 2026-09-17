import { and, eq, inArray, sql } from 'drizzle-orm';
import { getPublishingConsentStatus, schema } from '@axiom/db';
import { modelAccessCondition } from './model-access.js';
import { withOrgContext, writeAudit } from './routes/helpers.js';

export interface ReplyDispatchIdentity { orgId: string; modelId: string; userId: string; replyId: string }

/**
 * Commit the one-way dispatch fence before any message request. This is not a
 * queue lease: a crash after this commit MUST NOT reset the reply to pending.
 * Only the preparing actor can dispatch their exact immutable reply.
 */
export async function claimReplyDispatch(identity: ReplyDispatchIdentity) {
  const { orgId, modelId, userId, replyId } = identity;
  return withOrgContext(orgId, async tx => {
    // Use the same organization lock order as the audit writer. All checks are
    // performed after acquiring it, not against a pre-lock permission snapshot.
    await tx.execute(sql`SELECT id FROM org WHERE id = ${orgId} FOR UPDATE`);
    const [actor] = await tx.select().from(schema.authUser)
      .where(and(eq(schema.authUser.orgId, orgId), eq(schema.authUser.id, userId))).limit(1);
    if (!actor || !['owner', 'manager', 'operator', 'chatter'].includes(actor.role)) return { outcome: 'denied' as const };
    const [model] = await tx.select({ id: schema.modelProfile.id }).from(schema.modelProfile)
      .where(and(eq(schema.modelProfile.orgId, orgId), eq(schema.modelProfile.id, modelId), eq(schema.modelProfile.isActive, true),
        modelAccessCondition(actor.role, orgId, userId))).limit(1);
    if (!model) return { outcome: 'denied' as const };
    const scope = and(eq(schema.inboxReplyIntent.orgId, orgId), eq(schema.inboxReplyIntent.modelId, modelId),
      eq(schema.inboxReplyIntent.id, replyId), eq(schema.inboxReplyIntent.actorUserId, userId));
    const [reply] = await tx.select().from(schema.inboxReplyIntent).where(scope).limit(1);
    if (!reply) return { outcome: 'denied' as const };
    if (reply.state !== 'pending') return { outcome: 'already-dispatched' as const, reply };
    const [settings] = await tx.select().from(schema.orgSettings).where(eq(schema.orgSettings.orgId, orgId)).limit(1);
    if (settings?.publishingEnabled !== true) return { outcome: 'halted' as const };
    const [connection] = await tx.select().from(schema.platformConnection).where(and(
      eq(schema.platformConnection.orgId, orgId), eq(schema.platformConnection.modelId, modelId),
      eq(schema.platformConnection.id, reply.connectionId), eq(schema.platformConnection.platform, 'fanvue'),
      inArray(schema.platformConnection.status, ['active', 'connected']))).limit(1);
    if (!connection) return { outcome: 'account-unavailable' as const };
    if (!(await getPublishingConsentStatus(tx, orgId, modelId, 'fanvue')).ok) return { outcome: 'consent-required' as const };
    const [claimed] = await tx.update(schema.inboxReplyIntent)
      .set({ state: 'dispatching', dispatchedAt: sql`clock_timestamp()` })
      .where(and(scope, eq(schema.inboxReplyIntent.state, 'pending'), modelAccessCondition(actor.role, orgId, userId, schema.inboxReplyIntent.modelId))).returning();
    if (!claimed) return { outcome: 'denied' as const };
    await writeAudit(tx, orgId, userId, 'inbox.reply.dispatch', replyId, { modelId, connectionId: connection.id });
    return { outcome: 'claimed' as const, reply: claimed, connection };
  });
}

export type ReplyDeliveryResult = { state: 'sent'; messageUuid: string }
  | { state: 'rejected' | 'uncertain'; providerStatus?: number };

/** Persist the observed result, never turn a transport error into a safe retry. */
export async function finalizeReplyDispatch(identity: ReplyDispatchIdentity, result: ReplyDeliveryResult) {
  const { orgId, modelId, userId, replyId } = identity;
  return withOrgContext(orgId, async tx => {
    await tx.execute(sql`SELECT id FROM org WHERE id = ${orgId} FOR UPDATE`);
    const [record] = await tx.update(schema.inboxReplyIntent).set({
      state: result.state, remoteMessageUuid: result.state === 'sent' ? result.messageUuid : null,
      providerStatus: result.state === 'sent' ? 201 : result.providerStatus ?? null,
      finalizedAt: sql`clock_timestamp()`,
    }).where(and(eq(schema.inboxReplyIntent.orgId, orgId), eq(schema.inboxReplyIntent.modelId, modelId),
      eq(schema.inboxReplyIntent.id, replyId), eq(schema.inboxReplyIntent.actorUserId, userId),
      eq(schema.inboxReplyIntent.state, 'dispatching'))).returning();
    if (!record) return null;
    // Record a receipt even if a shift ends during provider latency. This does
    // not grant another dispatch or expose the record to a now-revoked caller.
    await writeAudit(tx, orgId, userId, `inbox.reply.${result.state}`, replyId, {
      modelId, connectionId: record.connectionId, providerStatus: record.providerStatus,
    });
    return record;
  });
}
