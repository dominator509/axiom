import { pgTable, uuid, text, jsonb, timestamp, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { bytea } from './types.js';

export const job = pgTable('job', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id),
  queue: text('queue').notNull(),
  kind: text('kind').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
  state: text('state').notNull().default('ready'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(8),
  lastError: text('last_error'),
  runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
  lockedBy: text('locked_by'),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  dedupeKey: bytea('dedupe_key'),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
});

export const jobRelations = relations(job, ({ one }) => ({
  org: one(org, {
    fields: [job.orgId],
    references: [org.id],
  }),
}));
