import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { linkbioProvider } from './linkbio_provider.js';

export const linkbioClick = pgTable('linkbio_click', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id, { onDelete: 'cascade' }),
  providerId: uuid('provider_id')
    .notNull()
    .references(() => linkbioProvider.id, { onDelete: 'cascade' }),
  target: text('target').notNull(),
  source: text('source'),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
});

export const linkbioClickRelations = relations(linkbioClick, ({ one }) => ({
  org: one(org, {
    fields: [linkbioClick.orgId],
    references: [org.id],
  }),
  provider: one(linkbioProvider, {
    fields: [linkbioClick.providerId],
    references: [linkbioProvider.id],
  }),
}));
