import { pgTable, uuid, text, timestamp, bigint, doublePrecision } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';

export const analyticsSnapshot = pgTable('analytics_snapshot', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  followers: bigint('followers', { mode: 'number' }).notNull().default(0),
  engagement: doublePrecision('engagement').notNull().default(0),
  reach: bigint('reach', { mode: 'number' }).notNull().default(0),
  impressions: bigint('impressions', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const analyticsSnapshotRelations = relations(analyticsSnapshot, ({ one }) => ({
  org: one(org, {
    fields: [analyticsSnapshot.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [analyticsSnapshot.modelId],
    references: [modelProfile.id],
  }),
}));
