import { pgTable, uuid, text, timestamp, doublePrecision, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';

export const banditState = pgTable('bandit_state', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id')
    .notNull()
    .references(() => modelProfile.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  context: text('context').notNull(),
  arm: text('arm').notNull(),
  alpha: doublePrecision('alpha').notNull().default(1),
  beta: doublePrecision('beta').notNull().default(1),
  plays: integer('plays').notNull().default(0),
  reward: doublePrecision('reward').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const banditStateRelations = relations(banditState, ({ one }) => ({
  org: one(org, {
    fields: [banditState.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [banditState.modelId],
    references: [modelProfile.id],
  }),
}));
