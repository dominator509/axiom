import { pgTable, uuid, text, timestamp, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const asset = pgTable('asset', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => import('./org.js').org.id),
  modelId: uuid('model_id').notNull().references(() => import('./model_profile.js').modelProfile.id),
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
  org: one(import('./org.js').org, {
    fields: [asset.orgId],
    references: [import('./org.js').org.id],
  }),
  model: one(import('./model_profile.js').modelProfile, {
    fields: [asset.modelId],
    references: [import('./model_profile.js').modelProfile.id],
  }),
  bundles: many(contentBundle),
}));

import { contentBundle } from './content_bundle.js';
