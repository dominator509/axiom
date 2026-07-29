import { pgTable, uuid, text, timestamp, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { contentBundle } from './content_bundle.js';

export const asset = pgTable('asset', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size').notNull(),
  storageKey: text('storage_key').notNull(),
  width: integer('width'),
  height: integer('height'),
  duration: integer('duration'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
