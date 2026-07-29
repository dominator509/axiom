import { pgTable, uuid, text, timestamp, bytea, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const platformConnection = pgTable('platform_connection', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => import('./org.js').org.id),
  modelId: uuid('model_id').notNull().references(() => import('./model_profile.js').modelProfile.id),
  platform: text('platform').notNull(),
  displayName: text('display_name').notNull(),
  encToken: bytea('enc_token').notNull(),
  encNonce: bytea('enc_nonce').notNull(),
  dekId: text('dek_id').notNull(),
  capabilities: jsonb('capabilities').$type<string[]>().default([]),
  status: text('status').notNull().default('active'),
  connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
});

export const platformConnectionRelations = relations(platformConnection, ({ one, many }) => ({
  org: one(import('./org.js').org, {
    fields: [platformConnection.orgId],
    references: [import('./org.js').org.id],
  }),
  model: one(import('./model_profile.js').modelProfile, {
    fields: [platformConnection.modelId],
    references: [import('./model_profile.js').modelProfile.id],
  }),
  postTargets: many(postTarget),
}));

import { postTarget } from './post_target.js';
