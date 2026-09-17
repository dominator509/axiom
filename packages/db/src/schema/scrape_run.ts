import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';

export type ScrapeRunKind = 'social' | 'competitor';
export type ScrapeRunState = 'queued' | 'running' | 'completed' | 'failed';

export const scrapeRun = pgTable('scrape_run', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<ScrapeRunKind>().notNull(),
  request: jsonb('request').$type<Record<string, unknown>>().notNull().default({}),
  result: jsonb('result').$type<Record<string, unknown> | null>(),
  state: text('state').$type<ScrapeRunState>().notNull().default('queued'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const scrapeRunRelations = relations(scrapeRun, ({ one }) => ({
  org: one(org, { fields: [scrapeRun.orgId], references: [org.id] }),
  model: one(modelProfile, { fields: [scrapeRun.modelId], references: [modelProfile.id] }),
}));
