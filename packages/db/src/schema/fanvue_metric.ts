import { pgTable, uuid, timestamp, integer, numeric, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';

export const fanvueMetric = pgTable('fanvue_metric', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  subscribers: integer('subscribers').notNull().default(0),
  earningsUsd: numeric('earnings_usd', { precision: 12, scale: 2 }).notNull().default('0'),
  messages: integer('messages').notNull().default(0),
  tips: integer('tips').notNull().default(0),
  tipEarningsUsd: numeric('tip_earnings_usd', { precision: 12, scale: 2 }).notNull().default('0'),
  raw: jsonb('raw').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const fanvueMetricRelations = relations(fanvueMetric, ({ one }) => ({
  org: one(org, {
    fields: [fanvueMetric.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [fanvueMetric.modelId],
    references: [modelProfile.id],
  }),
}));
