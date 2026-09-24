import { pgTable, uuid, text, boolean, jsonb, integer, timestamp, unique, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { platformConnection } from './platform_connection.js';

export const commentModerationRule = pgTable('comment_moderation_rule', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  platform: text('platform').notNull(),
  keywords: jsonb('keywords').$type<string[]>().notNull(),
  action: text('action').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdByUserId: text('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique('comment_moderation_rule_identity_unique').on(table.orgId, table.modelId, table.platform, table.name),
  index('comment_moderation_rule_scope_enabled').on(table.orgId, table.modelId, table.platform, table.enabled),
  check('comment_moderation_rule_action_check', sql`${table.action} IN ('hide', 'hide_and_block')`),
]);

export const commentModerationAction = pgTable('comment_moderation_action', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').notNull().references(() => platformConnection.id, { onDelete: 'cascade' }),
  ruleId: uuid('rule_id').notNull().references(() => commentModerationRule.id, { onDelete: 'cascade' }),
  postId: text('post_id').notNull(),
  providerCommentId: text('provider_comment_id').notNull(),
  matchedKeywordCount: integer('matched_keyword_count').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, table => [
  unique('comment_moderation_action_identity_unique').on(table.connectionId, table.ruleId, table.providerCommentId),
  index('comment_moderation_action_scope_time').on(table.orgId, table.modelId, table.createdAt),
  check('comment_moderation_action_status_check', sql`${table.status} IN ('pending', 'applied', 'partial', 'unknown', 'unsupported')`),
  check('comment_moderation_action_keyword_count_check', sql`${table.matchedKeywordCount} BETWEEN 1 AND 24`),
]);
