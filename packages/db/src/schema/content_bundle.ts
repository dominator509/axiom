import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { asset } from './asset.js';
import { postTarget } from './post_target.js';

export const contentBundle = pgTable('content_bundle', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id),
  modelId: uuid('model_id')
    .notNull()
    .references(() => modelProfile.id),
  assetId: uuid('asset_id').references(() => asset.id),
  captions: jsonb('captions').$type<Record<string, string>>().default({}),
  hashtags: jsonb('hashtags').$type<string[]>().default([]),
  tosReport: jsonb('tos_report').$type<Record<string, unknown>>(),
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
