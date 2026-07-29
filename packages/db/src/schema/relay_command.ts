import { pgTable, uuid, text, jsonb, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { relayCard } from './relay_card.js';

export const relayCommand = pgTable('relay_command', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id),
  cardId: uuid('card_id').notNull().references(() => relayCard.id),
  trigger: text('trigger').notNull(),
  action: text('action').notNull(),
  params: jsonb('params').$type<Record<string, unknown>>().default({}),
  enabled: boolean('enabled').notNull().default(true),
});

export const relayCommandRelations = relations(relayCommand, ({ one }) => ({
  org: one(org, {
    fields: [relayCommand.orgId],
    references: [org.id],
  }),
  card: one(relayCard, {
    fields: [relayCommand.cardId],
    references: [relayCard.id],
  }),
}));
