import { pgTable, uuid, text, boolean, timestamp, unique, index, foreignKey } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';

/** Providers with a documented cache-control contract in this release. */
export const CACHE_CONTROL_PROVIDERS = ['deepseek', 'anthropic', 'openai'] as const;
export type CacheControlProvider = (typeof CACHE_CONTROL_PROVIDERS)[number];

/**
 * Model-scoped, non-secret cache-control preferences.
 *
 * An absent row and a disabled row both preserve the existing provider
 * behaviour. Provider credentials, raw prompts, and upstream responses never
 * belong in this table.
 */
export const providerCacheControl = pgTable('provider_cache_control', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull(),
  provider: text('provider').$type<CacheControlProvider>().notNull(),
  enabled: boolean('enabled').notNull().default(false),
  prefixAlignment: boolean('prefix_alignment').notNull().default(false),
  promptCacheKey: text('prompt_cache_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique('provider_cache_control_identity').on(table.orgId, table.modelId, table.provider),
  index('idx_provider_cache_control_org_model').on(table.orgId, table.modelId),
  foreignKey({
    name: 'provider_cache_control_model_fk',
    columns: [table.orgId, table.modelId],
    foreignColumns: [modelProfile.orgId, modelProfile.id],
  }).onDelete('cascade'),
]);

export const providerCacheControlRelations = relations(providerCacheControl, ({ one }) => ({
  org: one(org, {
    fields: [providerCacheControl.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [providerCacheControl.orgId, providerCacheControl.modelId],
    references: [modelProfile.orgId, modelProfile.id],
  }),
}));
