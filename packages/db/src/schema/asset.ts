import { pgTable, uuid, text, timestamp, integer, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { contentBundle } from './content_bundle.js';
import { bytea } from './types.js';

export const asset = pgTable('asset', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id),
  kind: text('kind').notNull().default('image'),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size').notNull(),
  storageKey: text('storage_key').notNull(),
  // Content hash → idempotency (LBI-05, L3.1 §11). Unique (org_id, sha256)
  // enforces content-addressed dedupe (migration 0005).
  sha256: bytea('sha256').notNull(),
  nsfwRating: text('nsfw_rating'),
  width: integer('width'),
  height: integer('height'),
  duration: integer('duration'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('asset_org_sha256_unique').on(table.orgId, table.sha256),
]);

export const assetRelations = relations(asset, ({ one, many }) => ({
  org: one(org, {
    fields: [asset.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [asset.modelId],
    references: [modelProfile.id],
  }),
  bundles: many(contentBundle),
}));
