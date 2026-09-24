import { pgTable, uuid, text, timestamp, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { org } from './org.js';
import { linkbioProvider } from './linkbio_provider.js';

export const linkbioAnalytics = pgTable('linkbio_analytics', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id, { onDelete: 'cascade' }),
  providerId: uuid('provider_id').references(() => linkbioProvider.id, { onDelete: 'set null' }),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  kind: text('kind').notNull().default('click'),
  source: text('source'),
  referrer: text('referrer'),
  device: text('device'),
  utmSource: text('utm_source'),
  target: text('target'),
  externalEventId: text('external_event_id'),
  visits: integer('visits').notNull().default(0),
  uniqueVisitors: integer('unique_visitors').notNull().default(0),
  clicks: integer('clicks').notNull().default(0),
  conversions: integer('conversions').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_linkbio_analytics_provider_external_event')
    .on(table.providerId, table.externalEventId)
    .where(sql`${table.externalEventId} IS NOT NULL`),
  index('idx_linkbio_analytics_org_provider_ts').on(table.orgId, table.providerId, table.ts),
]);

export const linkbioAnalyticsRelations = relations(linkbioAnalytics, ({ one }) => ({
  org: one(org, {
    fields: [linkbioAnalytics.orgId],
    references: [org.id],
  }),
  provider: one(linkbioProvider, {
    fields: [linkbioAnalytics.providerId],
    references: [linkbioProvider.id],
  }),
}));
