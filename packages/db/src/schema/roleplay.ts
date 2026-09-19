import { relations, sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { teamShift } from './team_operations.js';
import { authUser } from './auth_user.js';

export type RoleplayActorType = 'human' | 'llm';
export type RoleplayMemoryRole = 'user' | 'assistant';
export type RoleplayPersonaSource = 'model_profile' | 'playbook' | 'soul.md';
export type RoleplayTurnState = 'pending' | 'completed' | 'uncertain' | 'rejected';

export interface RoleplayMemoryPolicy {
  maxTurns: number;
  maxCharacters: number;
}

export interface RoleplayPersonaMetadata {
  orgId: string;
  modelId: string;
  source: RoleplayPersonaSource;
  revision: number;
  sourceRef: string;
}

export interface RoleplayHandoffPayload {
  currentOwner: { type: RoleplayActorType; ref: string };
  actor: { type: RoleplayActorType; ref: string };
  orgId: string;
  modelId: string;
  shiftId: string;
  queue: string;
  conversationCursor: string | null;
  lastSafeSummary: string;
  pendingIntentId: string | null;
  memoryPolicy: RoleplayMemoryPolicy;
  personaSource: RoleplayPersonaMetadata | null;
  allowedNextAction: string;
  terminal: boolean;
  unresolvedUncertainty: string | null;
  evidenceReferences: string[];
}

export const roleplayPersonaRevision = pgTable('roleplay_persona_revision', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  source: text('source').$type<RoleplayPersonaSource>().notNull(),
  revision: integer('revision').notNull(),
  sourceRef: text('source_ref').notNull(),
  content: text('content').notNull(),
  createdByUserId: text('created_by_user_id').notNull().references(() => authUser.id),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
}, table => [
  uniqueIndex('roleplay_persona_scope_revision').on(table.orgId, table.modelId, table.source, table.revision),
  index('roleplay_persona_latest').on(table.orgId, table.modelId, table.source, table.revision),
  check('roleplay_persona_content_bound', sql`char_length(btrim(content)) > 0 AND char_length(content) <= 8000`),
  check('roleplay_persona_source_check', sql`source IN ('model_profile', 'playbook', 'soul.md')`),
  check('roleplay_persona_source_ref_check', sql`source_ref ~ '^(soul\\.md)(:[A-Za-z0-9._-]{1,128})?(:r[1-9][0-9]*)?$'`),
]);

export const roleplayMemoryTurn = pgTable('roleplay_memory_turn', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  conversationKey: text('conversation_key').notNull(),
  sequence: integer('sequence').notNull(),
  role: text('role').$type<RoleplayMemoryRole>().notNull(),
  speakerType: text('speaker_type').$type<RoleplayActorType>().notNull(),
  speakerRef: text('speaker_ref').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
}, table => [
  uniqueIndex('roleplay_memory_scope_sequence').on(table.orgId, table.modelId, table.conversationKey, table.sequence),
  index('roleplay_memory_tail').on(table.orgId, table.modelId, table.conversationKey, table.sequence),
  check('roleplay_memory_conversation_key_check', sql`conversation_key ~ '^[A-Za-z0-9._-]{1,128}$'`),
  check('roleplay_memory_role_check', sql`role IN ('user', 'assistant')`),
  check('roleplay_memory_speaker_type_check', sql`speaker_type IN ('human', 'llm')`),
  check('roleplay_memory_content_bound', sql`char_length(btrim(content)) > 0 AND char_length(content) <= 4000`),
]);

export const roleplayHandoff = pgTable('roleplay_handoff', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  conversationKey: text('conversation_key').notNull(),
  actorType: text('actor_type').$type<RoleplayActorType>().notNull(),
  actorRef: text('actor_ref').notNull(),
  shiftId: uuid('shift_id').notNull().references(() => teamShift.id),
  revision: integer('revision').notNull().default(1),
  payload: jsonb('payload').$type<RoleplayHandoffPayload>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
}, table => [
  uniqueIndex('roleplay_handoff_scope_conversation').on(table.orgId, table.modelId, table.conversationKey),
  index('roleplay_handoff_actor').on(table.orgId, table.modelId, table.actorType, table.actorRef),
  check('roleplay_handoff_conversation_key_check', sql`conversation_key ~ '^[A-Za-z0-9._-]{1,128}$'`),
  check('roleplay_handoff_actor_type_check', sql`actor_type IN ('human', 'llm')`),
  check('roleplay_handoff_payload_object', sql`jsonb_typeof(payload) = 'object'`),
]);

/**
 * One-way, idempotent provider turn ledger for the roleplay surface. This is
 * not an inbox and never authorizes publication; it records the bounded Grok
 * roleplay request/result so an uncertain provider outcome cannot be retried
 * implicitly or mistaken for a delivered social reply.
 */
export const roleplayTurn = pgTable('roleplay_turn', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  conversationKey: text('conversation_key').notNull(),
  intentKey: uuid('intent_key').notNull(),
  actorType: text('actor_type').$type<RoleplayActorType>().notNull(),
  actorRef: text('actor_ref').notNull(),
  shiftId: uuid('shift_id').notNull().references(() => teamShift.id),
  provider: text('provider').notNull().default('grok'),
  providerModel: text('provider_model').notNull(),
  personaRevision: integer('persona_revision'),
  input: text('input').notNull(),
  output: text('output'),
  state: text('state').$type<RoleplayTurnState>().notNull().default('pending'),
  providerRequestId: text('provider_request_id'),
  providerStatus: integer('provider_status'),
  errorCode: text('error_code'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  finalizedAt: timestamp('finalized_at', { withTimezone: true, precision: 3 }),
}, table => [
  uniqueIndex('roleplay_turn_scope_intent').on(table.orgId, table.modelId, table.intentKey),
  index('roleplay_turn_conversation').on(table.orgId, table.modelId, table.conversationKey, table.createdAt, table.id),
  check('roleplay_turn_conversation_key_check', sql`conversation_key ~ '^[A-Za-z0-9._-]{1,128}$'`),
  check('roleplay_turn_actor_type_check', sql`actor_type IN ('human', 'llm')`),
  check('roleplay_turn_provider_check', sql`provider IN ('grok')`),
  check('roleplay_turn_provider_model_bound', sql`char_length(btrim(provider_model)) > 0 AND char_length(provider_model) <= 128`),
  check('roleplay_turn_input_bound', sql`char_length(btrim(input)) > 0 AND char_length(input) <= 4000`),
  check('roleplay_turn_output_bound', sql`output IS NULL OR char_length(output) <= 8000`),
  check('roleplay_turn_state_check', sql`state IN ('pending', 'completed', 'uncertain', 'rejected')`),
  check('roleplay_turn_error_bound', sql`error_code IS NULL OR error_code ~ '^[a-z0-9._-]{1,64}$'`),
]);

export const roleplayPersonaRevisionRelations = relations(roleplayPersonaRevision, ({ one }) => ({
  org: one(org, { fields: [roleplayPersonaRevision.orgId], references: [org.id] }),
  model: one(modelProfile, { fields: [roleplayPersonaRevision.modelId], references: [modelProfile.id] }),
  createdBy: one(authUser, { fields: [roleplayPersonaRevision.createdByUserId], references: [authUser.id] }),
}));

export const roleplayMemoryTurnRelations = relations(roleplayMemoryTurn, ({ one }) => ({
  org: one(org, { fields: [roleplayMemoryTurn.orgId], references: [org.id] }),
  model: one(modelProfile, { fields: [roleplayMemoryTurn.modelId], references: [modelProfile.id] }),
}));

export const roleplayHandoffRelations = relations(roleplayHandoff, ({ one }) => ({
  org: one(org, { fields: [roleplayHandoff.orgId], references: [org.id] }),
  model: one(modelProfile, { fields: [roleplayHandoff.modelId], references: [modelProfile.id] }),
  shift: one(teamShift, { fields: [roleplayHandoff.shiftId], references: [teamShift.id] }),
}));

export const roleplayTurnRelations = relations(roleplayTurn, ({ one }) => ({
  org: one(org, { fields: [roleplayTurn.orgId], references: [org.id] }),
  model: one(modelProfile, { fields: [roleplayTurn.modelId], references: [modelProfile.id] }),
  shift: one(teamShift, { fields: [roleplayTurn.shiftId], references: [teamShift.id] }),
}));
