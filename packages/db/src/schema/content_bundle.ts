import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const contentBundle = pgTable('content_bundle', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => import('./org.js').org.id),
  modelId: uuid('model_id').notNull().references(() => import('./model_profile.js').modelProfile.id),
  assetId: uuid('asset_id'),
  captions: jsonb('captions').$type<Record<string, string>>().default({}),
  hashtags: jsonb('hashtags').$type<string[]>().default([]),
  tosReport: jsonb('tos_report').$type<Record<string, unknown>>(),
  state: text('state').notNull().default('generated'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const contentBundleRelations = relations(contentBundle, ({ one, many }) => ({
  org: one(import('./org.js').org, {
    fields: [contentBundle.orgId],
    references: [import('./org.js').org.id],
  }),
  model: one(import('./model_profile.js').modelProfile, {
    fields: [contentBundle.modelId],
    references: [import('./model_profile.js').modelProfile.id],
  }),
  asset: one(import('./asset.js').asset, {
    fields: [contentBundle.assetId],
    references: [import('./asset.js').asset.id],
  }),
  postTargets: many(postTarget),
}));

import { postTarget } from './post_target.js';
