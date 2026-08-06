import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { postTarget } from './post_target.js';

export const prePostRun = pgTable('pre_post_run', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  targetId: uuid('target_id').references(() => postTarget.id, { onDelete: 'set null' }),
  script: text('script').notNull(),
  status: text('status').notNull().default('pending'),
  input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
  output: jsonb('output').$type<Record<string, unknown>>(),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const prePostRunRelations = relations(prePostRun, ({ one }) => ({
  org: one(org, {
    fields: [prePostRun.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [prePostRun.modelId],
    references: [modelProfile.id],
  }),
  target: one(postTarget, {
    fields: [prePostRun.targetId],
    references: [postTarget.id],
  }),
}));
