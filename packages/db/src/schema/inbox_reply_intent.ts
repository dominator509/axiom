import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  unique,
  index,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { authUser } from './auth_user.js';
import { platformConnection } from './platform_connection.js';
import { roleplayTurn } from './roleplay.js';

export const inboxReplyIntent = pgTable(
  'inbox_reply_intent',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => org.id, { onDelete: 'cascade' }),
    modelId: uuid('model_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    actorUserId: text('actor_user_id').notNull(),
    counterpartUuid: uuid('counterpart_uuid').notNull(),
    intentKey: uuid('intent_key').notNull(),
    body: text('body').notNull(),
    draftSource: text('draft_source').$type<'human' | 'llm'>().notNull().default('human'),
    draftActorRef: text('draft_actor_ref'),
    roleplayTurnId: uuid('roleplay_turn_id').unique(),
    approvedByUserId: text('approved_by_user_id'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    state: text('state')
      .$type<'pending' | 'dispatching' | 'sent' | 'rejected' | 'uncertain' | 'cancelled'>()
      .notNull()
      .default('pending'),
    remoteMessageUuid: uuid('remote_message_uuid'),
    providerStatus: integer('provider_status'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  },
  (table) => [
    unique('inbox_reply_intent_key').on(table.orgId, table.actorUserId, table.intentKey),
    unique('inbox_reply_scope_identity').on(table.orgId, table.modelId, table.id),
    index('inbox_reply_conversation').on(
      table.orgId,
      table.modelId,
      table.connectionId,
      table.counterpartUuid,
      table.createdAt,
      table.id,
    ),
    foreignKey({
      name: 'inbox_reply_model',
      columns: [table.orgId, table.modelId],
      foreignColumns: [modelProfile.orgId, modelProfile.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'inbox_reply_connection',
      columns: [table.orgId, table.modelId, table.connectionId],
      foreignColumns: [platformConnection.orgId, platformConnection.modelId, platformConnection.id],
    }),
    foreignKey({
      name: 'inbox_reply_actor',
      columns: [table.orgId, table.actorUserId],
      foreignColumns: [authUser.orgId, authUser.id],
    }),
    foreignKey({
      name: 'inbox_reply_roleplay_turn',
      columns: [table.roleplayTurnId],
      foreignColumns: [roleplayTurn.id],
    }),
    foreignKey({
      name: 'inbox_reply_approver',
      columns: [table.orgId, table.approvedByUserId],
      foreignColumns: [authUser.orgId, authUser.id],
    }),
  ],
);
