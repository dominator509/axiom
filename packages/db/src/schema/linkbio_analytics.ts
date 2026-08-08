import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
