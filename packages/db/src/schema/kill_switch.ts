import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';

/**
 * Durable kill-switch log (LBI-12 / M-8). org_settings holds the live flag;
 * this table records every enable/disable flip with actor + reason for an
 * auditable history (RLS-scoped to the owning org, LBI-02).
 */
export const killSwitch = pgTable('kill_switch', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id, { onDelete: 'cascade' }),
  scope: text('scope').notNull().default('org').$type<'org' | 'model'>(),
  modelId: uuid('model_id').references(() => modelProfile.id, { onDelete: 'cascade' }),
  action: text('action').notNull().$type<'enable' | 'disable'>(),
  reason: text('reason'),
  actorRef: text('actor_ref').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
});

export const killSwitchRelations = relations(killSwitch, ({ one }) => ({
  org: one(org, {
    fields: [killSwitch.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [killSwitch.modelId],
    references: [modelProfile.id],
  }),
}));
