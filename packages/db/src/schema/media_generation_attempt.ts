import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { org } from './org.js';

/** Durable one-shot boundary; retained when the executor transaction rolls back. */
export const mediaGenerationAttempt = pgTable('media_generation_attempt', {
  jobId: uuid('job_id').primaryKey(),
  orgId: uuid('org_id').notNull().references(() => org.id),
  bundleId: uuid('bundle_id').notNull(),
  modelId: uuid('model_id').notNull(),
  userId: text('user_id').notNull(),
  kind: text('kind').notNull(),
  state: text('state').notNull().default('dispatched'),
  assetId: uuid('asset_id'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});
