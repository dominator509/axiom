import { pgTable, uuid, text, timestamp, doublePrecision, bigint } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { postTarget } from './post_target.js';

export const postMetric = pgTable('post_metric', {
  id: uuid('id').primaryKey().defaultRandom(),
  postTargetId: uuid('post_target_id').notNull().references(() => postTarget.id),
  platform: text('platform').notNull(),
  remoteId: text('remote_id').notNull(),
  views: bigint('views', { mode: 'number' }).notNull().default(0),
  likes: bigint('likes', { mode: 'number' }).notNull().default(0),
  shares: bigint('shares', { mode: 'number' }).notNull().default(0),
  comments: bigint('comments', { mode: 'number' }).notNull().default(0),
  engagementRate: doublePrecision('engagement_rate').notNull().default(0),
  collectedAt: timestamp('collected_at', { withTimezone: true }).notNull().defaultNow(),
});

export const postMetricRelations = relations(postMetric, ({ one }) => ({
  postTarget: one(postTarget, {
    fields: [postMetric.postTargetId],
    references: [postTarget.id],
  }),
}));
