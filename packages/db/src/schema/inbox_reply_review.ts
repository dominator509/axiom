import { pgTable, uuid, text, timestamp, unique, index, foreignKey } from 'drizzle-orm/pg-core';
import { org } from './org.js';
import { authUser } from './auth_user.js';
import { inboxReplyIntent } from './inbox_reply_intent.js';

/** Operator testimony, not an automatically verified provider receipt. Append only. */
export const inboxReplyReview = pgTable('inbox_reply_review', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull(), replyId: uuid('reply_id').notNull(), actorUserId: text('actor_user_id').notNull(),
  intentKey: uuid('intent_key').notNull(),
  conclusion: text('conclusion').$type<'observed_sent' | 'unresolved'>().notNull(),
  observedMessageUuid: uuid('observed_message_uuid'), note: text('note').notNull(),
  evidenceSource: text('evidence_source').$type<'operator_review'>().notNull().default('operator_review'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique('inbox_reply_review_key').on(table.orgId, table.actorUserId, table.intentKey),
  index('inbox_reply_review_history').on(table.orgId, table.modelId, table.replyId, table.createdAt, table.id),
  foreignKey({ name: 'inbox_reply_review_parent', columns: [table.orgId, table.modelId, table.replyId], foreignColumns: [inboxReplyIntent.orgId, inboxReplyIntent.modelId, inboxReplyIntent.id] }).onDelete('cascade'),
  foreignKey({ name: 'inbox_reply_review_actor', columns: [table.orgId, table.actorUserId], foreignColumns: [authUser.orgId, authUser.id] }),
]);
