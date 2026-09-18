import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { asset } from './asset.js';
import { assetVariant } from './asset_variant.js';
import { postTarget } from './post_target.js';

export type ContentBundlePublishIntent = {
  action: 'schedule' | 'publish';
  platform: string;
  scheduledAt: string | null;
};

export interface CaptionGuidanceReceipt {
  version: 'caption-guidance-v1';
  selectedArm: string | null;
  context: string;
  exemplarIds: string[];
  captionSha256: string;
}

/** Existing photoshoot controls captured for immutable publication evidence. */
export interface PhotoshootRecipe {
  style: string;
  outfit: string;
  location: string;
  mood: string;
  lighting: string;
  aspectRatio: string;
}

export const contentBundle = pgTable('content_bundle', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id),
  modelId: uuid('model_id')
    .notNull()
    .references(() => modelProfile.id),
  assetId: uuid('asset_id').references(() => asset.id),
  sourceVariantId: uuid('source_variant_id').references(() => assetVariant.id, { onDelete: 'restrict' }),
  captions: jsonb('captions').$type<Record<string, string>>().default({}),
  captionGuidance: jsonb('caption_guidance').$type<Record<string, CaptionGuidanceReceipt>>().notNull().default({}),
  hashtags: jsonb('hashtags').$type<string[]>().default([]),
  generationRecipe: jsonb('generation_recipe').$type<PhotoshootRecipe | null>(),
  tosReport: jsonb('tos_report').$type<Record<string, unknown>>(),
  publishIntent: jsonb('publish_intent').$type<ContentBundlePublishIntent>(),
  state: text('state').notNull().default('generated'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const contentBundleRelations = relations(contentBundle, ({ one, many }) => ({
  org: one(org, {
    fields: [contentBundle.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [contentBundle.modelId],
    references: [modelProfile.id],
  }),
  asset: one(asset, {
    fields: [contentBundle.assetId],
    references: [asset.id],
  }),
  postTargets: many(postTarget),
}));
