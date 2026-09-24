import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { asset } from './asset.js';
import { assetVariant } from './asset_variant.js';

export type MediaOperationType = 'image_clip' | 'image_resize' | 'video_clip' | 'video_transcode';
export type MediaOperationState = 'queued' | 'running' | 'completed' | 'failed';

export const mediaOperation = pgTable('media_operation', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  sourceAssetId: uuid('source_asset_id').notNull().references(() => asset.id, { onDelete: 'cascade' }),
  resultVariantId: uuid('result_variant_id').references(() => assetVariant.id, { onDelete: 'set null' }),
  type: text('type').$type<MediaOperationType>().notNull(),
  options: jsonb('options').$type<Record<string, unknown>>().notNull().default({}),
  state: text('state').$type<MediaOperationState>().notNull().default('queued'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const mediaOperationRelations = relations(mediaOperation, ({ one }) => ({
  org: one(org, { fields: [mediaOperation.orgId], references: [org.id] }),
  model: one(modelProfile, { fields: [mediaOperation.modelId], references: [modelProfile.id] }),
  sourceAsset: one(asset, { fields: [mediaOperation.sourceAssetId], references: [asset.id] }),
  resultVariant: one(assetVariant, { fields: [mediaOperation.resultVariantId], references: [assetVariant.id] }),
}));
