import { pgTable, uuid, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';

export const agentPermission = pgTable('agent_permission', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  agentRef: text('agent_ref').notNull(),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  tier: text('tier').notNull().default('read'),
  canPublish: boolean('can_publish').notNull().default(false),
  canEdit: boolean('can_edit').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const agentPermissionRelations = relations(agentPermission, ({ one }) => ({
  org: one(org, {
    fields: [agentPermission.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [agentPermission.modelId],
    references: [modelProfile.id],
  }),
}));
