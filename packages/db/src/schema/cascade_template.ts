import { pgTable, uuid, text, jsonb, boolean, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';

export interface CascadeStep {
  platform: string;
  offsetMinutes: number;
}

export const cascadeTemplate = pgTable('cascade_template', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  steps: jsonb('steps').$type<CascadeStep[]>().notNull().default([]),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cascadeTemplateRelations = relations(cascadeTemplate, ({ one }) => ({
  org: one(org, { fields: [cascadeTemplate.orgId], references: [org.id] }),
  model: one(modelProfile, { fields: [cascadeTemplate.modelId], references: [modelProfile.id] }),
}));
