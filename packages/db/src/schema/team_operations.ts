import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';

export type TeamShiftAssigneeType = 'human' | 'llm';

export const teamShift = pgTable('team_shift', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  assigneeUserId: text('assignee_user_id'),
  assigneeType: text('assignee_type').$type<TeamShiftAssigneeType>().notNull().default('human'),
  assigneeAgentRef: text('assignee_agent_ref'),
  queue: text('queue').notNull().default('inbox'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('scheduled'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const teamNote = pgTable('team_note', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  authorUserId: text('author_user_id').notNull(),
  targetType: text('target_type').notNull().default('model'),
  targetId: text('target_id'),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const teamShiftRelations = relations(teamShift, ({ one }) => ({
  org: one(org, { fields: [teamShift.orgId], references: [org.id] }),
  model: one(modelProfile, { fields: [teamShift.modelId], references: [modelProfile.id] }),
}));
export const teamNoteRelations = relations(teamNote, ({ one }) => ({
  org: one(org, { fields: [teamNote.orgId], references: [org.id] }),
  model: one(modelProfile, { fields: [teamNote.modelId], references: [modelProfile.id] }),
}));
