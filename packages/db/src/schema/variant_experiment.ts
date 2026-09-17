import { pgTable, uuid, text, jsonb, boolean, doublePrecision, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { assetVariant } from './asset_variant.js';

export type VariantExperimentStatus = 'draft' | 'running' | 'paused' | 'completed';

export const variantExperiment = pgTable('variant_experiment', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  platform: text('platform').notNull(),
  variantIds: jsonb('variant_ids').$type<string[]>().notNull().default([]),
  status: text('status').$type<VariantExperimentStatus>().notNull().default('draft'),
  winnerVariantId: uuid('winner_variant_id').references(() => assetVariant.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('variant_experiment_model_name_unique').on(table.modelId, table.name),
]);

export const variantExperimentAssignment = pgTable('variant_experiment_assignment', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  experimentId: uuid('experiment_id').notNull().references(() => variantExperiment.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').notNull().references(() => assetVariant.id, { onDelete: 'cascade' }),
  assignmentKey: text('assignment_key').notNull(),
  converted: boolean('converted').notNull().default(false),
  metricValue: doublePrecision('metric_value'),
  outcomeAt: timestamp('outcome_at', { withTimezone: true }),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('variant_experiment_assignment_key_unique').on(table.experimentId, table.assignmentKey),
]);

export const variantExperimentRelations = relations(variantExperiment, ({ one, many }) => ({
  org: one(org, { fields: [variantExperiment.orgId], references: [org.id] }),
  model: one(modelProfile, { fields: [variantExperiment.modelId], references: [modelProfile.id] }),
  winner: one(assetVariant, { fields: [variantExperiment.winnerVariantId], references: [assetVariant.id] }),
  assignments: many(variantExperimentAssignment),
}));

export const variantExperimentAssignmentRelations = relations(variantExperimentAssignment, ({ one }) => ({
  org: one(org, { fields: [variantExperimentAssignment.orgId], references: [org.id] }),
  experiment: one(variantExperiment, { fields: [variantExperimentAssignment.experimentId], references: [variantExperiment.id] }),
  variant: one(assetVariant, { fields: [variantExperimentAssignment.variantId], references: [assetVariant.id] }),
}));
