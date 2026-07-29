import { pgTable, uuid, text, jsonb, boolean, integer, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const relayCard = pgTable('relay_card', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => import('./org.js').org.id),
  title: text('title').notNull(),
  description: text('description'),
  icon: text('icon'),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  enabled: boolean('enabled').notNull().default(true),
  priority: integer('priority').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const relayCardRelations = relations(relayCard, ({ one, many }) => ({
  org: one(import('./org.js').org, {
    fields: [relayCard.orgId],
    references: [import('./org.js').org.id],
  }),
  commands: many(relayCommand),
}));

import { relayCommand } from './relay_command.js';
