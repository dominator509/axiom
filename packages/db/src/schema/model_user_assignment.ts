import { pgTable, uuid, text, timestamp, unique, index, foreignKey } from 'drizzle-orm/pg-core';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { authUser } from './auth_user.js';

export const modelUserAssignment = pgTable('model_user_assignment', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull(),
  userId: text('user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique('model_user_assignment_identity').on(table.orgId, table.modelId, table.userId),
  index('model_user_assignment_user_scope').on(table.orgId, table.userId, table.modelId),
  foreignKey({ name: 'model_user_assignment_model', columns: [table.orgId, table.modelId], foreignColumns: [modelProfile.orgId, modelProfile.id] }).onDelete('cascade'),
  foreignKey({ name: 'model_user_assignment_user', columns: [table.orgId, table.userId], foreignColumns: [authUser.orgId, authUser.id] }).onDelete('cascade'),
]);
