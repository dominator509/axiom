import { pgTable, uuid, text, timestamp, unique, index, check, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { platformConnection } from './platform_connection.js';
import { shortLink } from './short_link.js';

/** Minimal signed-event receipt. Provider payloads and purchaser PII are never persisted. */
export const fanvueWebhookEvent = pgTable('fanvue_webhook_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').notNull().references(() => platformConnection.id, { onDelete: 'cascade' }),
  providerEventId: text('provider_event_id').notNull(),
  eventType: text('event_type').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  payloadDigest: text('payload_digest').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique('fanvue_webhook_connection_event_unique').on(table.connectionId, table.providerEventId),
  unique('fanvue_webhook_id_scope_unique').on(table.id, table.orgId, table.modelId, table.connectionId),
  index('fanvue_webhook_scope_time').on(table.orgId, table.modelId, table.connectionId, table.receivedAt),
]);

/** Operator-reviewed rescue sends with durable unknown-outcome protection. */
export const fanvueChurnRescue = pgTable('fanvue_churn_rescue', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').notNull().references(() => platformConnection.id, { onDelete: 'cascade' }),
  webhookEventId: uuid('webhook_event_id').notNull().references(() => fanvueWebhookEvent.id, { onDelete: 'cascade' }),
  providerEventId: text('provider_event_id').notNull(),
  subscriptionId: text('subscription_id').notNull(),
  recipientUuid: text('recipient_uuid').notNull(),
  status: text('status').notNull().default('ready'),
  attemptedByUserId: text('attempted_by_user_id'),
  attemptStartedAt: timestamp('attempt_started_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  remoteMessageId: text('remote_message_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique('fanvue_churn_rescue_subscription_unique').on(table.connectionId, table.subscriptionId),
  index('fanvue_churn_rescue_scope_status').on(table.orgId, table.modelId, table.status, table.createdAt),
  check('fanvue_churn_rescue_status_check', sql`${table.status} IN ('ready', 'sending', 'sent', 'unknown', 'failed', 'dismissed')`),
  check('fanvue_churn_rescue_recipient_uuid_check', sql`${table.recipientUuid} ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`),
]);

/** Attribution facts captured on a subscription event for its later payment. */
export const fanvueSubscriptionAttribution = pgTable('fanvue_subscription_attribution', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').notNull().references(() => platformConnection.id, { onDelete: 'cascade' }),
  subscriptionId: text('subscription_id').notNull(),
  shortLinkId: uuid('short_link_id').references(() => shortLink.id, { onDelete: 'set null' }),
  utm: jsonb('utm').$type<Record<string, string>>().notNull().default({}),
  providerEventId: text('provider_event_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique('fanvue_subscription_attribution_connection_id_unique').on(table.connectionId, table.subscriptionId),
  index('fanvue_subscription_attribution_scope').on(table.orgId, table.modelId, table.connectionId, table.updatedAt),
  check('fanvue_subscription_attribution_subscription_check', sql`length(${table.subscriptionId}) BETWEEN 1 AND 240`),
]);
