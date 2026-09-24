// ─── fanvue.analytics.sync executor (L2.10 F-06/F-07) ───
// Reads documented Fanvue insight projections, updates the tenant/model CRM,
// and normalizes provider transactions into idempotent touchpoints.  This is
// read/sync only: it cannot send messages, publish, or mutate provider state.

import { and, eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import {
  FanvueConnector,
  type FanvueEarningsPage,
  type FanvueFanInsight,
  type FanvueSubscriberEventsPage,
  type FanvueTopSpender,
} from '@axiom/connectors';
import { connectorForTarget } from '../connection.js';
import { enqueueJob } from '../enqueue.js';
import type { Executor, ExecutorContext } from './context.js';

export const FANVUE_ANALYTICS_INTERVAL_MS = 15 * 60_000;
const MAX_PROVIDER_PAGES = 200;
const FANVUE_PLATFORM = 'fanvue';
const EVENT_KINDS = new Set(['subscription', 'tip', 'message', 'post', 'refund', 'purchase']);

export type FanvueContactTier = 'whale' | 'loyal' | 'expired' | 'new';

export function classifyFanvueContact(
  topSpender: boolean,
  status: FanvueFanInsight['status'] | undefined,
): FanvueContactTier {
  if (status === 'expired') return 'expired';
  if (topSpender) return 'whale';
  if (status === 'subscriber') return 'loyal';
  return 'new';
}

function asUsd(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

function safeIso(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`fanvue.analytics.sync: invalid ${name}`);
  return parsed.toISOString();
}

async function allTopSpenders(connector: FanvueConnector, startDate?: string, endDate?: string) {
  const rows: FanvueTopSpender[] = [];
  for (let page = 1; page <= MAX_PROVIDER_PAGES; page += 1) {
    const result = await connector.fetchTopSpenders(startDate, endDate, page, 50);
    rows.push(...result.data);
    if (!result.pagination.hasMore) return rows;
  }
  throw new Error('fanvue.analytics.sync: top-spender pagination exceeded safety bound');
}

async function allSubscriberEvents(connector: FanvueConnector, startDate?: string, endDate?: string) {
  const rows: FanvueSubscriberEventsPage['data'] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PROVIDER_PAGES; page += 1) {
    const result = await connector.fetchSubscriberEvents(startDate, endDate, cursor, 50);
    rows.push(...result.data);
    if (!result.nextCursor) return rows;
    cursor = result.nextCursor;
  }
  throw new Error('fanvue.analytics.sync: subscriber pagination exceeded safety bound');
}

async function allEarnings(connector: FanvueConnector, startDate?: string, endDate?: string) {
  const rows: FanvueEarningsPage['data'] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PROVIDER_PAGES; page += 1) {
    const result = await connector.fetchEarningsPage(startDate, endDate, cursor, 50);
    rows.push(...result.data);
    if (!result.nextCursor) return rows;
    cursor = result.nextCursor;
  }
  throw new Error('fanvue.analytics.sync: earnings pagination exceeded safety bound');
}

async function fanInsights(
  connector: FanvueConnector,
  uuids: string[],
): Promise<Record<string, FanvueFanInsight | null>> {
  const result: Record<string, FanvueFanInsight | null> = {};
  for (let index = 0; index < uuids.length; index += 20) {
    Object.assign(result, await connector.fetchFanInsights(uuids.slice(index, index + 20)));
  }
  return result;
}

function eventKind(source: string): string | null {
  if (source === 'subscription' || source === 'tip' || source === 'message' || source === 'post' || source === 'refund') return source;
  if (source === 'affiliate' || source === 'referral') return 'purchase';
  return EVENT_KINDS.has(source) ? source : null;
}

export const fanvueAnalyticsSync: Executor = async (ctx: ExecutorContext) => {
  const { tx, job } = ctx;
  const payload = (job.payload ?? {}) as {
    modelId?: string;
    connectionId?: string;
    startDate?: string;
    endDate?: string;
  };
  if (!payload.modelId) throw new Error('fanvue.analytics.sync: payload.modelId required');

  const startDate = safeIso(payload.startDate, 'startDate');
  const endDate = safeIso(payload.endDate, 'endDate');
  if (startDate && endDate && startDate >= endDate) {
    throw new Error('fanvue.analytics.sync: startDate must precede endDate');
  }

  const { connection, connector } = await connectorForTarget(tx, job.org_id, payload.modelId, {
    connectionId: payload.connectionId ?? null,
    platform: FANVUE_PLATFORM,
  });
  if (!(connector instanceof FanvueConnector)) {
    throw new Error('fanvue.analytics.sync: Fanvue connector unavailable');
  }

  // The subscriber smart-list is the only documented current audience count;
  // subscriber events are a time series and must not be mistaken for it.
  const [smartLists, topSpenders, subscriberEvents, earnings, unread] = await Promise.all([
    connector.fetchSmartLists(),
    allTopSpenders(connector, startDate, endDate),
    allSubscriberEvents(connector, startDate, endDate),
    allEarnings(connector, startDate, endDate),
    connector.fetchUnreadCounts(),
  ]);
  const subscriberList = smartLists.find((list) => list.uuid === 'subscribers');
  if (!subscriberList) throw new Error('fanvue.analytics.sync: subscriber smart-list count unavailable');

  const topByUser = new Map(topSpenders.map((row) => [row.user.uuid, row]));
  const eventUsers = earnings.flatMap((row) => row.user ? [row.user.uuid] : []);
  const insightUsers = [...new Set([...topByUser.keys(), ...eventUsers])];
  const insights = await fanInsights(connector, insightUsers);
  const contactInputs = new Map<string, {
    displayName: string;
    tier: FanvueContactTier;
    lifetimeValueUsd: string;
    lastActiveAt: Date | undefined;
  }>();

  for (const userId of insightUsers) {
    const top = topByUser.get(userId);
    const insight = insights[userId] ?? undefined;
    const eventDates = earnings
      .filter((row) => row.user?.uuid === userId)
      .map((row) => new Date(row.date));
    const lastEvent = eventDates.sort((a, b) => b.getTime() - a.getTime())[0];
    const lastValidPurchase = insight?.spending.lastValidPurchaseAt
      ? new Date(insight.spending.lastValidPurchaseAt)
      : undefined;
    contactInputs.set(userId, {
      displayName: top?.user.displayName ?? earnings.find((row) => row.user?.uuid === userId)?.user?.displayName ?? userId,
      tier: classifyFanvueContact(Boolean(top?.user.isTopSpender), insight?.status),
      lifetimeValueUsd: asUsd(insight?.spending.total.netTotal ?? top?.net ?? 0),
      lastActiveAt: [lastEvent, lastValidPurchase].filter((value): value is Date => Boolean(value))
        .sort((a, b) => b.getTime() - a.getTime())[0],
    });
  }

  const contacts: Array<{ id: string; externalId: string }> = [];
  for (const [externalId, value] of contactInputs) {
    const rows = await tx
      .insert(schema.fanCrmContact)
      .values({
        orgId: job.org_id,
        modelId: payload.modelId,
        platform: FANVUE_PLATFORM,
        externalId,
        displayName: value.displayName,
        tier: value.tier,
        lifetimeValueUsd: value.lifetimeValueUsd,
        lastActiveAt: value.lastActiveAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.fanCrmContact.orgId, schema.fanCrmContact.modelId, schema.fanCrmContact.platform, schema.fanCrmContact.externalId],
        set: {
          displayName: value.displayName,
          tier: value.tier,
          lifetimeValueUsd: value.lifetimeValueUsd,
          lastActiveAt: value.lastActiveAt,
          updatedAt: new Date(),
        },
      })
      .returning({ id: schema.fanCrmContact.id, externalId: schema.fanCrmContact.externalId });
    contacts.push(...rows);
  }
  const contactRows = contacts.length ? contacts : await tx
    .select({ id: schema.fanCrmContact.id, externalId: schema.fanCrmContact.externalId })
    .from(schema.fanCrmContact)
    .where(and(eq(schema.fanCrmContact.orgId, job.org_id), eq(schema.fanCrmContact.modelId, payload.modelId), eq(schema.fanCrmContact.platform, FANVUE_PLATFORM)));
  const contactIds = new Map(contactRows.map((contact: { externalId: string; id: string }) => [contact.externalId, contact.id]));

  for (const event of earnings) {
    const kind = eventKind(event.source);
    const fanId = event.user ? contactIds.get(event.user.uuid) : undefined;
    if (!kind || !fanId) continue;
    await tx.insert(schema.fanTouchpoint).values({
      orgId: job.org_id,
      fanId,
      platform: FANVUE_PLATFORM,
      kind,
      direction: 'inbound',
      content: null,
      externalEventId: event.transactionOrderId,
      ts: new Date(event.date),
    }).onConflictDoNothing({ target: schema.fanTouchpoint.externalEventId });
  }

  const subscriberEventsNew = subscriberEvents.reduce((sum, row) => sum + row.newSubscribersCount, 0);
  const subscriberEventsCancelled = subscriberEvents.reduce((sum, row) => sum + row.cancelledSubscribersCount, 0);
  const tips = earnings.filter((row) => row.source === 'tip');
  const windowStart = startDate ? new Date(startDate) : undefined;
  const windowEnd = endDate ? new Date(endDate) : undefined;
  await tx.insert(schema.fanvueMetric).values({
    orgId: job.org_id,
    modelId: payload.modelId,
    ts: new Date(),
    subscribers: subscriberList.count,
    earningsUsd: asUsd(earnings.reduce((sum, row) => sum + row.net, 0)),
    // This field is the documented unread-message observation; the explicit
    // unread_messages column keeps the distinction visible to consumers.
    messages: unread.unreadMessagesCount,
    tips: tips.length,
    tipEarningsUsd: asUsd(tips.reduce((sum, row) => sum + row.net, 0)),
    subscriberEventsNew,
    subscriberEventsCancelled,
    unreadMessages: unread.unreadMessagesCount,
    topSpenderCount: new Set(topSpenders.map((row) => row.user.uuid)).size,
    windowStart,
    windowEnd,
  });

  const nextRunAt = new Date(Date.now() + FANVUE_ANALYTICS_INTERVAL_MS);
  await enqueueJob(tx, {
    orgId: job.org_id,
    queue: 'metrics',
    kind: 'fanvue.analytics.sync',
    payload: { modelId: payload.modelId, connectionId: connection.id },
    runAfter: nextRunAt,
    maxAttempts: job.max_attempts,
    dedupeParts: ['fanvue.analytics.sync', payload.modelId, connection.id, Math.floor(nextRunAt.getTime() / FANVUE_ANALYTICS_INTERVAL_MS)],
  });
};
