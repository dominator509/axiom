import { pgTable, uuid, text, jsonb, boolean, integer, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { contentBundle } from './content_bundle.js';
import { relayCommand } from './relay_command.js';

export const relayCard = pgTable('relay_card', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id),
  // L3.1 §5 dispatch-log fields (migration 0005): a relay_card records a card
  // pushed to a channel for a bundle. bundle_id/channel/external_ref/state are
  // the spec shape; the config columns below remain for card templates.
  bundleId: uuid('bundle_id').references(() => contentBundle.id),
  channel: text('channel'),
  externalRef: text('external_ref'),
  state: text('state').notNull().default('sent'),
  title: text('title').notNull().default(''),
  description: text('description'),
  icon: text('icon'),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  enabled: boolean('enabled').notNull().default(true),
  priority: integer('priority').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const relayCardRelations = relations(relayCard, ({ one, many }) => ({
  org: one(org, {
    fields: [relayCard.orgId],
    references: [org.id],
  }),
  commands: many(relayCommand),
}));
