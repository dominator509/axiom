import { pgTable, uuid, text, timestamp, vector } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { viralRecipe } from './viral_recipe.js';
import { modelProfile } from './model_profile.js';

export const viralEmbedding = pgTable('viral_embedding', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id, { onDelete: 'cascade' }),
  recipeId: uuid('recipe_id')
    .notNull()
    .references(() => viralRecipe.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id')
    .notNull()
    .references(() => modelProfile.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  embedding: vector('embedding', { dimensions: 768 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const viralEmbeddingRelations = relations(viralEmbedding, ({ one }) => ({
  org: one(org, {
    fields: [viralEmbedding.orgId],
    references: [org.id],
  }),
  recipe: one(viralRecipe, {
    fields: [viralEmbedding.recipeId],
    references: [viralRecipe.id],
  }),
  model: one(modelProfile, {
    fields: [viralEmbedding.modelId],
    references: [modelProfile.id],
  }),
}));
