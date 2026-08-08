import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { bytea } from './types.js';
import { postTarget } from './post_target.js';

export const platformConnection = pgTable('platform_connection', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id),
  modelId: uuid('model_id')
    .notNull()
    .references(() => modelProfile.id),
  platform: text('platform').notNull(),
  displayName: text('display_name').notNull(),
  encToken: bytea('enc_token').notNull(),
  encNonce: bytea('enc_nonce').notNull(),
  dekId: text('dek_id').notNull(),
  capabilities: jsonb('capabilities').$type<string[]>().default([]),
  status: text('status').notNull().default('connected'),
  connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
});

export const platformConnectionRelations = relations(platformConnection, ({ one, many }) => ({
  org: one(org, {
    fields: [platformConnection.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [platformConnection.modelId],
    references: [modelProfile.id],
  }),
  postTargets: many(postTarget),
}));
