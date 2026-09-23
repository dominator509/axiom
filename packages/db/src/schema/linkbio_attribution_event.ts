import { relations, sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, unique, uuid, integer } from 'drizzle-orm/pg-core';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { shortLink } from './short_link.js';
import { platformConnection } from './platform_connection.js';

export type LinkbioAttributionSource = 'fanvue';
export type LinkbioAttributionKind = 'subscription' | 'ppv_purchase' | 'subscription_refund';

/**
 * Append-only provider facts used to join first-party link clicks to
 * authoritative Fanvue revenue events. Raw provider payloads and credentials
 * are deliberately not stored; eventKey is the provider's stable idempotency
 * identity and utm is the bounded attribution context returned by the source.
 */
export const linkbioAttributionEvent = pgTable('linkbio_attribution_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  shortLinkId: uuid('short_link_id').references(() => shortLink.id, { onDelete: 'set null' }),
  fanvueConnectionId: uuid('fanvue_connection_id').references(() => platformConnection.id, { onDelete: 'set null' }),
  fanvueSubscriptionId: text('fanvue_subscription_id'),
  source: text('source').$type<LinkbioAttributionSource>().notNull().default('fanvue'),
  eventKey: text('event_key').notNull(),
  kind: text('kind').$type<LinkbioAttributionKind>().notNull(),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull().default('USD'),
  utm: jsonb('utm').$type<Record<string, string>>().notNull().default({}),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique('linkbio_attribution_event_source_key_unique').on(table.orgId, table.source, table.eventKey),
  index('linkbio_attribution_event_model_time').on(table.orgId, table.modelId, table.occurredAt),
  index('linkbio_attribution_event_short_link_time').on(table.shortLinkId, table.occurredAt),
  index('linkbio_attribution_fanvue_subscription').on(table.orgId, table.modelId, table.fanvueConnectionId, table.fanvueSubscriptionId),
  check('linkbio_attribution_event_source_check', sql`source IN ('fanvue')`),
  check('linkbio_attribution_event_kind_check', sql`kind IN ('subscription', 'ppv_purchase', 'subscription_refund')`),
  check('linkbio_attribution_event_amount_check', sql`amount_cents >= 0`),
  check('linkbio_attribution_event_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
]);

export const linkbioAttributionEventRelations = relations(linkbioAttributionEvent, ({ one }) => ({
  org: one(org, { fields: [linkbioAttributionEvent.orgId], references: [org.id] }),
  model: one(modelProfile, { fields: [linkbioAttributionEvent.modelId], references: [modelProfile.id] }),
  shortLink: one(shortLink, { fields: [linkbioAttributionEvent.shortLinkId], references: [shortLink.id] }),
  fanvueConnection: one(platformConnection, { fields: [linkbioAttributionEvent.fanvueConnectionId], references: [platformConnection.id] }),
}));
