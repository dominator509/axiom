import { pgTable, uuid, text, timestamp, jsonb, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';

export const triggerRule = pgTable('trigger_rule', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id')
    .notNull()
    .references(() => modelProfile.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  platform: text('platform').notNull(),
  condition: jsonb('condition').$type<Record<string, unknown>>().notNull().default({}),
  action: jsonb('action').$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const triggerRuleRelations = relations(triggerRule, ({ one }) => ({
  org: one(org, {
    fields: [triggerRule.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [triggerRule.modelId],
    references: [modelProfile.id],
  }),
}));
