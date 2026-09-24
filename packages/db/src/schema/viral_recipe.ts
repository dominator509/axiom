import { pgTable, uuid, text, timestamp, doublePrecision, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { postTarget } from './post_target.js';

export const viralRecipe = pgTable('viral_recipe', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id')
    .notNull()
    .references(() => modelProfile.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  sourceTargetId: uuid('source_target_id').unique('viral_recipe_source_target_unique')
    .references(() => postTarget.id, { onDelete: 'restrict' }),
  label: text('label').notNull().default('baseline'),
  perfScore: doublePrecision('perf_score').notNull().default(0),
  recipe: jsonb('recipe').$type<Record<string, unknown>>().notNull().default({}),
  realizedMetrics: jsonb('realized_metrics').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const viralRecipeRelations = relations(viralRecipe, ({ one }) => ({
  org: one(org, {
    fields: [viralRecipe.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [viralRecipe.modelId],
    references: [modelProfile.id],
  }),
}));
