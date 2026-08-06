import { pgTable, uuid, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';

export const playbookScore = pgTable('playbook_score', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id')
    .notNull()
    .references(() => modelProfile.id, { onDelete: 'cascade' }),
  score: integer('score').notNull(),
  components: jsonb('components').$type<Record<string, unknown>>().default({}),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
});

export const playbookScoreRelations = relations(playbookScore, ({ one }) => ({
  org: one(org, {
    fields: [playbookScore.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [playbookScore.modelId],
    references: [modelProfile.id],
  }),
}));
