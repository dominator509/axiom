import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';

/** Daily aggregate of provider-reported cache counters; no prompt data is stored. */
export const providerCacheObservation = pgTable('provider_cache_observation', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull(),
  provider: text('provider').notNull(),
  observedOn: date('observed_on', { mode: 'string' }).notNull(),
  observedResponses: integer('observed_responses').notNull().default(0),
  unobservedResponses: integer('unobserved_responses').notNull().default(0),
  promptTokens: bigint('prompt_tokens', { mode: 'number' }).notNull().default(0),
  cachedPromptTokens: bigint('cached_prompt_tokens', { mode: 'number' }).notNull().default(0),
  cacheCreationPromptTokens: bigint('cache_creation_prompt_tokens', { mode: 'number' }).notNull().default(0),
  lastObservedAt: timestamp('last_observed_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique('provider_cache_observation_identity').on(
    table.orgId,
    table.modelId,
    table.provider,
    table.observedOn,
  ),
  index('idx_provider_cache_observation_org_model_day').on(
    table.orgId,
    table.modelId,
    table.observedOn,
  ),
  foreignKey({
    name: 'provider_cache_observation_model_fk',
    columns: [table.orgId, table.modelId],
    foreignColumns: [modelProfile.orgId, modelProfile.id],
  }).onDelete('cascade'),
  check('provider_cache_observation_provider_bounded', sql`${table.provider} ~ '^[a-z0-9_-]{1,64}$'`),
  check('provider_cache_observation_counts_nonnegative', sql`
    ${table.observedResponses} >= 0
    AND ${table.unobservedResponses} >= 0
    AND ${table.promptTokens} >= 0
    AND ${table.cachedPromptTokens} >= 0
    AND ${table.cacheCreationPromptTokens} >= 0
    AND ${table.cachedPromptTokens} + ${table.cacheCreationPromptTokens} <= ${table.promptTokens}
  `),
]);

export const providerCacheObservationRelations = relations(providerCacheObservation, ({ one }) => ({
  org: one(org, {
    fields: [providerCacheObservation.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [providerCacheObservation.orgId, providerCacheObservation.modelId],
    references: [modelProfile.orgId, modelProfile.id],
  }),
}));
