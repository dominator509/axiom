import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';

export const playbookGuideline = pgTable('playbook_guideline', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  optimalTimes: jsonb('optimal_times').$type<string[]>().notNull().default([]),
  cadencePerWeek: integer('cadence_per_week').notNull().default(3),
  upsellStrategy: text('upsell_strategy').notNull().default(''),
  revision: integer('revision').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('playbook_guideline_model_platform_unique').on(table.modelId, table.platform)]);

export const playbookGuidelineRelations = relations(playbookGuideline, ({ one }) => ({
  org: one(org, { fields: [playbookGuideline.orgId], references: [org.id] }),
  model: one(modelProfile, { fields: [playbookGuideline.modelId], references: [modelProfile.id] }),
}));
