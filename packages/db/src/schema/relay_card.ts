import {
  pgTable,
  uuid,
  text,
  jsonb,
  boolean,
  integer,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import type { RelayCardState } from '@axiom/core';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { contentBundle } from './content_bundle.js';
import { relayCommand } from './relay_command.js';

export const relayCard = pgTable(
  'relay_card',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => org.id),
    // Model-scoped insight cards do not require a content bundle. Keep the
    // ownership explicit so Relay history can expose durable analytics cards
    // without manufacturing a bundle relationship.
    modelId: uuid('model_id').references(() => modelProfile.id, { onDelete: 'cascade' }),
    // L3.1 §5 dispatch-log fields (migration 0005): a relay_card records a card
    // pushed to a channel for a bundle. bundle_id/channel/external_ref/state are
    // the spec shape; the config columns below remain for card templates.
    bundleId: uuid('bundle_id').references(() => contentBundle.id),
    channel: text('channel'),
    externalRef: text('external_ref'),
    state: text('state').$type<RelayCardState>().notNull().default('sent'),
    title: text('title').notNull().default(''),
    description: text('description'),
    icon: text('icon'),
    config: jsonb('config').$type<Record<string, unknown>>().default({}),
    enabled: boolean('enabled').notNull().default(true),
    priority: integer('priority').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Only one unresolved provider dispatch may exist for a bundle/channel/ref.
    // Sent rows remain durable history and must not block a later review cycle.
    uniqueIndex('relay_card_pending_dispatch_unique')
      .on(table.orgId, table.bundleId, table.channel, table.externalRef)
      .where(sql`${table.state} = 'pending'`),
    // Model-scoped insight dispatches have no bundle_id. PostgreSQL treats
    // NULLs as distinct in the bundle index above, so they need their own
    // identity guard to prevent duplicate provider messages per binding.
    uniqueIndex('relay_card_viral_pending_dispatch_unique')
      .on(table.orgId, table.modelId, table.channel, table.externalRef)
      .where(sql`${table.state} = 'pending' AND ${table.modelId} IS NOT NULL AND ${table.bundleId} IS NULL`),
  ],
);

export const relayCardRelations = relations(relayCard, ({ one, many }) => ({
  org: one(org, {
    fields: [relayCard.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [relayCard.modelId],
    references: [modelProfile.id],
  }),
  commands: many(relayCommand),
}));
