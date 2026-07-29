import { pgTable, uuid, text, jsonb, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const relayCommand = pgTable('relay_command', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => import('./org.js').org.id),
  cardId: uuid('card_id').notNull().references(() => import('./relay_card.js').relayCard.id),
  trigger: text('trigger').notNull(),
  action: text('action').notNull(),
  params: jsonb('params').$type<Record<string, unknown>>().default({}),
  enabled: boolean('enabled').notNull().default(true),
});

export const relayCommandRelations = relations(relayCommand, ({ one }) => ({
  org: one(import('./org.js').org, {
    fields: [relayCommand.orgId],
    references: [import('./org.js').org.id],
  }),
  card: one(import('./relay_card.js').relayCard, {
    fields: [relayCommand.cardId],
    references: [import('./relay_card.js').relayCard.id],
  }),
}));
