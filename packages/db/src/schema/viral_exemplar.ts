import { pgTable, uuid, text, jsonb, timestamp, vector, doublePrecision } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { contentBundle } from './content_bundle.js';

// Blueprint L3.1 §6 — viral memory loop exemplar. label is a constrained
// performance bucket ('viral' | 'strong' | 'baseline' | 'weak'), perf_score is
// the normalized engagement z-score, features holds caption/hook/timing/tags.
export const viralExemplar = pgTable('viral_exemplar', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id),
  bundleId: uuid('bundle_id').references(() => contentBundle.id),
  platform: text('platform').notNull(),
  features: jsonb('features').$type<Record<string, unknown>>().notNull().default({}),
  embedding: vector('embedding', { dimensions: 768 }).notNull(),
  perfScore: doublePrecision('perf_score').notNull().default(0),
  label: text('label').notNull().default('baseline'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const viralExemplarRelations = relations(viralExemplar, ({ one }) => ({
  org: one(org, {
    fields: [viralExemplar.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [viralExemplar.modelId],
    references: [modelProfile.id],
  }),
  bundle: one(contentBundle, {
    fields: [viralExemplar.bundleId],
    references: [contentBundle.id],
  }),
}));
