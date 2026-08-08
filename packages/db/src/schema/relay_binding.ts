import { pgTable, uuid, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';

export const relayBinding = pgTable('relay_binding', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id')
    .notNull()
    .references(() => modelProfile.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(),
  chatRef: text('chat_ref'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const relayBindingRelations = relations(relayBinding, ({ one }) => ({
  org: one(org, {
    fields: [relayBinding.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [relayBinding.modelId],
    references: [modelProfile.id],
  }),
}));
