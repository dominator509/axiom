// Signed Fanvue lifecycle and payment events plus operator-reviewed churn rescue.
import { Hono } from 'hono';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@axiom/db';
import { connectorForConnection } from '@axiom/worker';
import type { AppBindings } from '../index.js';
import { readBoundedText, RequestBodyTooLargeError } from '../webhook-body.js';
import { rateLimit } from '../contract.js';
import { verifyFanvueWebhookSignature, parseFanvueWebhook, fanvueDeactivatedSubscription, fanvueSubscriptionAttribution, fanvueSuccessfulPayment } from '../fanvue-webhook-contract.js';
import { apiError, modelOrgId, requireOrg, statusTitle, withOrgContext, writeAudit } from './helpers.js';

const router = new Hono<AppBindings>();
const rescueSendSchema = z.object({
  message: z.string().trim().min(1).max(3_500),
  offerText: z.string().trim().min(1).max(500),
}).strict();
const readableRoles = new Set(['owner', 'manager', 'operator', 'analyst', 'content_creator', 'model']);
const sendRoles = new Set(['owner', 'manager', 'operator']);

router.use('/webhooks/fanvue/*', rateLimit({ capacity: 120, refillPerSec: 2, maxBuckets: 100_000 }));

/** Public provider callback. The signed body and connection URL bind the event to one Fanvue account. */
router.post('/webhooks/fanvue/:orgId/:connectionId', async (c) => {
  let rawBody: string;
  try { rawBody = await readBoundedText(c.req.raw, 1_048_576); }
  catch (error) {
    if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'Fanvue webhook body too large');
    return apiError(c, 400, statusTitle(400), 'Fanvue webhook body could not be read');
  }
  const secret = process.env.FANVUE_WEBHOOK_SECRET;
  if (!verifyFanvueWebhookSignature(rawBody, c.req.header('x-fanvue-signature'), secret)) {
    return apiError(c, 401, statusTitle(401), 'Fanvue webhook verification failed');
  }
  const event = parseFanvueWebhook(rawBody);
  if (!event) return apiError(c, 400, statusTitle(400), 'invalid Fanvue event envelope');
  const orgId = c.req.param('orgId');
  const connectionId = c.req.param('connectionId');
  const connection = await withOrgContext(orgId, async (tx) => {
    const [row] = await tx.select().from(schema.platformConnection).where(and(
      eq(schema.platformConnection.id, connectionId),
      eq(schema.platformConnection.orgId, orgId),
      eq(schema.platformConnection.platform, 'fanvue'),
      inArray(schema.platformConnection.status, ['connected', 'active']),
    )).limit(1);
    return row ?? null;
  });
  if (!connection) return apiError(c, 404, statusTitle(404), 'Fanvue connection not found');
  const churn = fanvueDeactivatedSubscription(event);
  const subscriptionAttribution = fanvueSubscriptionAttribution(event);
  const payment = fanvueSuccessfulPayment(event);
  if (event.type === 'creator.subscription.deactivated' && !churn) {
    return apiError(c, 400, statusTitle(400), 'deactivated subscription event is missing its creator identifier');
  }
  if (event.type === 'creator.payment.succeeded' && !payment) {
    return apiError(c, 400, statusTitle(400), 'payment event is missing supported attribution fields');
  }
  if ((event.type === 'creator.subscription.activated' || event.type === 'creator.subscription.renewed') && !subscriptionAttribution) {
    return apiError(c, 400, statusTitle(400), 'subscription event is missing its creator or subscription identifier');
  }
  if (!churn && !payment && !subscriptionAttribution) return c.json({ accepted: true, ignored: true }, 202);

  try {
    const { connector } = await connectorForConnection(connection);
    const eventCreatorUuid = churn?.creatorUuid ?? subscriptionAttribution?.creatorUuid ?? payment?.creatorUuid;
    if (typeof eventCreatorUuid !== 'string' || !connector.auth.externalUserId || eventCreatorUuid !== connector.auth.externalUserId) {
      return apiError(c, 403, statusTitle(403), 'Fanvue event does not match the connected creator account');
    }
    const result = await withOrgContext(orgId, async (tx) => {
      const inserted = await tx.insert(schema.fanvueWebhookEvent).values({
        orgId,
        modelId: connection.modelId,
        connectionId,
        providerEventId: event.id,
        eventType: event.type,
        occurredAt: event.occurredAt,
        payloadDigest: event.digest,
      }).onConflictDoNothing({
        target: [schema.fanvueWebhookEvent.connectionId, schema.fanvueWebhookEvent.providerEventId],
      }).returning({ id: schema.fanvueWebhookEvent.id });
      if (inserted.length === 0) return { duplicate: true, rescueCreated: false, attributionCreated: false };
      const receiptId = inserted[0].id;
      let rescueCreated = false;
      let attributionCreated = false;
      if (churn?.eligible && churn.recipientUuid) {
        const rescues = await tx.insert(schema.fanvueChurnRescue).values({
          orgId, modelId: connection.modelId, connectionId, webhookEventId: receiptId,
          providerEventId: event.id, subscriptionId: churn.subscriptionId, recipientUuid: churn.recipientUuid,
          status: 'ready',
        }).onConflictDoNothing({
          target: [schema.fanvueChurnRescue.connectionId, schema.fanvueChurnRescue.subscriptionId],
        }).returning({ id: schema.fanvueChurnRescue.id });
        rescueCreated = rescues.length > 0;
      }
      if (subscriptionAttribution) {
        const links = await tx.select({ id: schema.shortLink.id, utm: schema.shortLink.utm }).from(schema.shortLink)
          .where(and(eq(schema.shortLink.orgId, orgId), eq(schema.shortLink.modelId, connection.modelId))).limit(1001);
        if (links.length > 1000) throw new Error('Fanvue attribution exceeds the bounded link count');
        const matching = Object.keys(subscriptionAttribution.utm).length === 0 ? [] : links.filter((link: { id: string; utm: unknown }) => {
          const saved = link.utm && typeof link.utm === 'object' && !Array.isArray(link.utm) ? link.utm as Record<string, unknown> : {};
          return Object.entries(subscriptionAttribution.utm).every(([key, value]) => saved[key] === value);
        });
        const shortLinkId = matching.length === 1 ? matching[0].id : null;
        if (Object.keys(subscriptionAttribution.utm).length > 0) {
          await tx.insert(schema.fanvueSubscriptionAttribution).values({
            orgId, modelId: connection.modelId, connectionId,
            subscriptionId: subscriptionAttribution.subscriptionId, shortLinkId,
            utm: subscriptionAttribution.utm, providerEventId: event.id, occurredAt: event.occurredAt,
          }).onConflictDoUpdate({
            target: [schema.fanvueSubscriptionAttribution.connectionId, schema.fanvueSubscriptionAttribution.subscriptionId],
            set: { shortLinkId, utm: subscriptionAttribution.utm, providerEventId: event.id, occurredAt: event.occurredAt, updatedAt: new Date() },
          });
          await tx.update(schema.linkbioAttributionEvent).set({ shortLinkId, utm: subscriptionAttribution.utm }).where(and(
            eq(schema.linkbioAttributionEvent.orgId, orgId),
            eq(schema.linkbioAttributionEvent.modelId, connection.modelId),
            eq(schema.linkbioAttributionEvent.fanvueConnectionId, connectionId),
            eq(schema.linkbioAttributionEvent.fanvueSubscriptionId, subscriptionAttribution.subscriptionId),
          ));
          attributionCreated = true;
        }
      }
      if (payment) {
        const savedSubscriptionAttribution = payment.subscriptionId ? (await tx.select({
          shortLinkId: schema.fanvueSubscriptionAttribution.shortLinkId,
          utm: schema.fanvueSubscriptionAttribution.utm,
        }).from(schema.fanvueSubscriptionAttribution).where(and(
          eq(schema.fanvueSubscriptionAttribution.orgId, orgId),
          eq(schema.fanvueSubscriptionAttribution.modelId, connection.modelId),
          eq(schema.fanvueSubscriptionAttribution.connectionId, connectionId),
          eq(schema.fanvueSubscriptionAttribution.subscriptionId, payment.subscriptionId),
        )).limit(1))[0] : undefined;
        let resolvedUtm = savedSubscriptionAttribution?.utm as Record<string, string> | undefined;
        let shortLinkId = savedSubscriptionAttribution?.shortLinkId ?? null;
        if (!resolvedUtm || Object.keys(resolvedUtm).length === 0) {
          resolvedUtm = payment.utm;
          if (Object.keys(resolvedUtm).length > 0) {
            const links = await tx.select({ id: schema.shortLink.id, utm: schema.shortLink.utm }).from(schema.shortLink)
              .where(and(eq(schema.shortLink.orgId, orgId), eq(schema.shortLink.modelId, connection.modelId))).limit(1001);
            if (links.length > 1000) throw new Error('Fanvue attribution exceeds the bounded link count');
            const matching = links.filter((link: { id: string; utm: unknown }) => {
              const saved = link.utm && typeof link.utm === 'object' && !Array.isArray(link.utm) ? link.utm as Record<string, unknown> : {};
              return Object.entries(resolvedUtm!).every(([key, value]) => saved[key] === value);
            });
            shortLinkId = matching.length === 1 ? matching[0].id : null;
          }
        }
        const attribution = await tx.insert(schema.linkbioAttributionEvent).values({
          orgId, modelId: connection.modelId, shortLinkId, source: 'fanvue',
          eventKey: `payment:${payment.paymentId}`, kind: payment.kind,
          amountCents: payment.amountCents, currency: payment.currency, utm: resolvedUtm ?? {},
          fanvueConnectionId: connectionId, fanvueSubscriptionId: payment.subscriptionId,
          occurredAt: event.occurredAt,
        }).onConflictDoNothing({
          target: [schema.linkbioAttributionEvent.orgId, schema.linkbioAttributionEvent.source, schema.linkbioAttributionEvent.eventKey],
        }).returning({ id: schema.linkbioAttributionEvent.id });
        attributionCreated = attribution.length > 0;
      }
      await writeAudit(tx, orgId, 'fanvue:webhook', 'fanvue.webhook.accept', receiptId, {
        eventType: event.type, rescueCreated, attributionCreated,
      });
      return { duplicate: false, rescueCreated, attributionCreated };
    });
    return c.json({ accepted: true, ...result }, result.duplicate ? 200 : 202);
  } catch {
    return apiError(c, 502, statusTitle(502), 'Fanvue event could not be committed; provider should retry');
  }
});

router.get('/models/:modelId/fanvue/churn-rescues', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const role = c.get('role');
  if (!readableRoles.has(role ?? '')) return apiError(c, 403, statusTitle(403), 'role cannot read churn rescue history');
  const modelId = c.req.param('modelId');
  const result = await withOrgContext(orgId, async (tx) => {
    if ((await modelOrgId(tx, modelId)) !== orgId) return null;
    const [rows, connections] = await Promise.all([tx.select({
      id: schema.fanvueChurnRescue.id,
      providerEventId: schema.fanvueChurnRescue.providerEventId,
      subscriptionId: schema.fanvueChurnRescue.subscriptionId,
      status: schema.fanvueChurnRescue.status,
      sentAt: schema.fanvueChurnRescue.sentAt,
      remoteMessageId: schema.fanvueChurnRescue.remoteMessageId,
      createdAt: schema.fanvueChurnRescue.createdAt,
    }).from(schema.fanvueChurnRescue).where(and(
      eq(schema.fanvueChurnRescue.orgId, orgId), eq(schema.fanvueChurnRescue.modelId, modelId),
    )).orderBy(desc(schema.fanvueChurnRescue.createdAt)).limit(100), tx.select({
      id: schema.platformConnection.id,
      status: schema.platformConnection.status,
    }).from(schema.platformConnection).where(and(
      eq(schema.platformConnection.orgId, orgId), eq(schema.platformConnection.modelId, modelId),
      eq(schema.platformConnection.platform, 'fanvue'), inArray(schema.platformConnection.status, ['connected', 'active']),
    ))]);
    return {
      rows,
      setup: {
        webhookConfigured: Boolean(process.env.FANVUE_WEBHOOK_SECRET),
        endpoints: connections.map((connection: { id: string }) => `/api/v1/webhooks/fanvue/${orgId}/${connection.id}`),
      },
    };
  });
  if (!result) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: result.rows, setup: result.setup, meta: { total: result.rows.length } });
});

router.post('/models/:modelId/fanvue/churn-rescues/:rescueId/send', async (c) => {
  const orgId = requireOrg(c);
  const userId = c.get('userId');
  const role = c.get('role');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!sendRoles.has(role ?? '')) return apiError(c, 403, statusTitle(403), 'only an owner, manager or operator can send a rescue message');
  let payload: unknown;
  try {
    const raw = await readBoundedText(c.req.raw, 8_192);
    payload = JSON.parse(raw);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'rescue message body too large');
    return apiError(c, 400, statusTitle(400), 'invalid rescue message body');
  }
  const parsed = rescueSendSchema.safeParse(payload);
  if (!parsed.success) {
    return apiError(c, 400, statusTitle(400), 'message and an operator-authored offer are required');
  }
  const { message, offerText } = parsed.data;
  const modelId = c.req.param('modelId');
  const rescueId = c.req.param('rescueId');
  const claimed = await withOrgContext(orgId, async (tx) => {
    if ((await modelOrgId(tx, modelId)) !== orgId) return null;
    const rescues = await tx.select().from(schema.fanvueChurnRescue).where(and(
      eq(schema.fanvueChurnRescue.id, rescueId),
      eq(schema.fanvueChurnRescue.orgId, orgId),
      eq(schema.fanvueChurnRescue.modelId, modelId),
      eq(schema.fanvueChurnRescue.status, 'ready'),
    )).limit(1).for('update');
    const rescue = rescues[0];
    if (!rescue) return { error: 'rescue is missing, already handled or has an uncertain send outcome' } as const;
    const connections = await tx.select().from(schema.platformConnection).where(and(
      eq(schema.platformConnection.id, rescue.connectionId),
      eq(schema.platformConnection.orgId, orgId),
      eq(schema.platformConnection.modelId, modelId),
      eq(schema.platformConnection.platform, 'fanvue'),
      inArray(schema.platformConnection.status, ['connected', 'active']),
    )).limit(1);
    if (!connections[0]) return { error: 'Fanvue connection is no longer active' } as const;
    return { rescue, connection: connections[0] } as const;
  });
  if (!claimed) return apiError(c, 404, statusTitle(404), 'model not found');
  if ('error' in claimed) return apiError(c, 409, statusTitle(409), claimed.error ?? 'rescue could not be claimed');

  let connector;
  try {
    connector = (await connectorForConnection(claimed.connection)).connector;
  } catch {
    return apiError(c, 503, statusTitle(503), 'Fanvue connection credentials or egress are unavailable');
  }
  const capability = connector.capability();
  if (!capability.operations?.includes('messages.send') || !connector.executeOperation) {
    return apiError(c, 403, statusTitle(403), 'Fanvue direct-message permission was not granted');
  }

  const startedAt = new Date();
  const marked = await withOrgContext(orgId, (tx) => tx.update(schema.fanvueChurnRescue).set({
    status: 'sending', attemptedByUserId: userId, attemptStartedAt: startedAt,
  }).where(and(
    eq(schema.fanvueChurnRescue.id, rescueId), eq(schema.fanvueChurnRescue.orgId, orgId),
    eq(schema.fanvueChurnRescue.modelId, modelId), eq(schema.fanvueChurnRescue.status, 'ready'),
  )).returning({ id: schema.fanvueChurnRescue.id }));
  if (marked.length === 0) return apiError(c, 409, statusTitle(409), 'rescue has already been claimed');

  let operation: Awaited<ReturnType<NonNullable<typeof connector.executeOperation>>>;
  try {
    operation = await connector.executeOperation({
      type: 'messages.send', recipientId: claimed.rescue.recipientUuid, text: `${message}\n\n${offerText}`,
    });
    if (operation.type !== 'mutation' || operation.success !== true) throw new Error('Fanvue did not confirm the message send');
  } catch {
    await withOrgContext(orgId, async (tx) => {
      await tx.update(schema.fanvueChurnRescue).set({ status: 'unknown' }).where(and(
        eq(schema.fanvueChurnRescue.id, rescueId), eq(schema.fanvueChurnRescue.orgId, orgId),
        eq(schema.fanvueChurnRescue.modelId, modelId), eq(schema.fanvueChurnRescue.status, 'sending'),
      ));
      await writeAudit(tx, orgId, userId, 'fanvue.churn_rescue.unknown', rescueId, { messageLength: message.length, offerLength: offerText.length });
    });
    return c.json({ data: { id: rescueId, status: 'unknown' }, warning: 'Fanvue may have received the message; automatic retry is disabled.' }, 202);
  }
  const completed = await withOrgContext(orgId, async (tx) => {
    const [row] = await tx.update(schema.fanvueChurnRescue).set({
      status: 'sent', sentAt: new Date(), remoteMessageId: operation.remoteId ?? null,
    }).where(and(
      eq(schema.fanvueChurnRescue.id, rescueId), eq(schema.fanvueChurnRescue.orgId, orgId),
      eq(schema.fanvueChurnRescue.modelId, modelId), eq(schema.fanvueChurnRescue.status, 'sending'),
    )).returning({ id: schema.fanvueChurnRescue.id, status: schema.fanvueChurnRescue.status, sentAt: schema.fanvueChurnRescue.sentAt });
    if (row) await writeAudit(tx, orgId, userId, 'fanvue.churn_rescue.sent', rescueId, {
      remoteMessageId: operation.remoteId ?? null,
      messageLength: message.length, offerLength: offerText.length,
    });
    return row ?? null;
  });
  if (!completed) return apiError(c, 502, statusTitle(502), 'Fanvue accepted the message but local delivery state could not be confirmed');
  return c.json({ data: completed }, 201);
});

export { router as fanvueLifecycleRouter };
