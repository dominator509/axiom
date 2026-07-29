import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const job = pgTable('job', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => import('./org.js').org.id),
  queue: text('queue').notNull(),
  kind: text('kind').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
  state: text('state').notNull().default('ready'),
  attempts: text('attempts').notNull().default('0'),
  maxAttempts: text('max_attempts').notNull().default('3'),
  lastError: text('last_error'),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const jobRelations = relations(job, ({ one }) => ({
  org: one(import('./org.js').org, {
    fields: [job.orgId],
    references: [import('./org.js').org.id],
  }),
}));
