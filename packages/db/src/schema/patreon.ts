import { pgTable, uuid, text, timestamp, integer, boolean, index, unique } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { platformConnection } from './platform_connection.js';

/** Durable, model-scoped Patreon v2 read/sync state. No raw provider payloads. */
export const patreonCampaign = pgTable('patreon_campaign', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').notNull().references(() => platformConnection.id, { onDelete: 'cascade' }),
  providerCampaignId: text('provider_campaign_id').notNull(),
  creatorProviderId: text('creator_provider_id').notNull(),
  name: text('name').notNull().default(''),
  providerCreatedAt: text('provider_created_at'),
  providerPublishedAt: text('provider_published_at'),
  patronCount: integer('patron_count'),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique('patreon_campaign_connection_provider_unique').on(table.connectionId, table.providerCampaignId),
  index('patreon_campaign_scope_lookup').on(table.orgId, table.modelId, table.connectionId),
]);

export const patreonMembership = pgTable('patreon_membership', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').notNull().references(() => platformConnection.id, { onDelete: 'cascade' }),
  providerMemberId: text('provider_member_id').notNull(),
  providerCampaignId: text('provider_campaign_id').notNull(),
  tierId: text('tier_id'),
  tierTitle: text('tier_title'),
  status: text('status').notNull(),
  currentlyEntitledAmountCents: integer('currently_entitled_amount_cents'),
  lastChargeStatus: text('last_charge_status'),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique('patreon_membership_connection_provider_unique').on(table.connectionId, table.providerMemberId),
  index('patreon_membership_scope_campaign').on(table.orgId, table.modelId, table.connectionId, table.providerCampaignId),
]);

export const patreonPost = pgTable('patreon_post', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').notNull().references(() => platformConnection.id, { onDelete: 'cascade' }),
  providerPostId: text('provider_post_id').notNull(),
  providerCampaignId: text('provider_campaign_id').notNull(),
  title: text('title').notNull().default(''),
  isPublic: boolean('is_public').notNull().default(false),
  providerPublishedAt: text('provider_published_at'),
  providerUrl: text('provider_url'),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique('patreon_post_connection_provider_unique').on(table.connectionId, table.providerPostId),
  index('patreon_post_scope_campaign').on(table.orgId, table.modelId, table.connectionId, table.providerCampaignId),
]);

export const patreonSyncState = pgTable('patreon_sync_state', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').notNull().references(() => platformConnection.id, { onDelete: 'cascade' }),
  resource: text('resource').notNull(),
  lastCursor: text('last_cursor'),
  nextCursor: text('next_cursor'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  lastError: text('last_error'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique('patreon_sync_state_connection_resource_unique').on(table.connectionId, table.resource),
  index('patreon_sync_state_scope_lookup').on(table.orgId, table.modelId, table.connectionId),
]);

export const patreonWebhookEvent = pgTable('patreon_webhook_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').notNull().references(() => platformConnection.id, { onDelete: 'cascade' }),
  providerEventId: text('provider_event_id').notNull(),
  eventType: text('event_type').notNull().default('unknown'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  payloadDigest: text('payload_digest').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique('patreon_webhook_connection_event_unique').on(table.connectionId, table.providerEventId),
  index('patreon_webhook_scope_time').on(table.orgId, table.modelId, table.connectionId, table.receivedAt),
]);

export const patreonCampaignRelations = relations(patreonCampaign, ({ one }) => ({
  org: one(org, { fields: [patreonCampaign.orgId], references: [org.id] }),
  model: one(modelProfile, { fields: [patreonCampaign.modelId], references: [modelProfile.id] }),
  connection: one(platformConnection, { fields: [patreonCampaign.connectionId], references: [platformConnection.id] }),
}));

export const patreonMembershipRelations = relations(patreonMembership, ({ one }) => ({
  org: one(org, { fields: [patreonMembership.orgId], references: [org.id] }),
  model: one(modelProfile, { fields: [patreonMembership.modelId], references: [modelProfile.id] }),
  connection: one(platformConnection, { fields: [patreonMembership.connectionId], references: [platformConnection.id] }),
}));

export const patreonPostRelations = relations(patreonPost, ({ one }) => ({
  org: one(org, { fields: [patreonPost.orgId], references: [org.id] }),
  model: one(modelProfile, { fields: [patreonPost.modelId], references: [modelProfile.id] }),
  connection: one(platformConnection, { fields: [patreonPost.connectionId], references: [platformConnection.id] }),
}));

export const patreonSyncStateRelations = relations(patreonSyncState, ({ one }) => ({
  org: one(org, { fields: [patreonSyncState.orgId], references: [org.id] }),
  model: one(modelProfile, { fields: [patreonSyncState.modelId], references: [modelProfile.id] }),
  connection: one(platformConnection, { fields: [patreonSyncState.connectionId], references: [platformConnection.id] }),
}));

export const patreonWebhookEventRelations = relations(patreonWebhookEvent, ({ one }) => ({
  org: one(org, { fields: [patreonWebhookEvent.orgId], references: [org.id] }),
  model: one(modelProfile, { fields: [patreonWebhookEvent.modelId], references: [modelProfile.id] }),
  connection: one(platformConnection, { fields: [patreonWebhookEvent.connectionId], references: [platformConnection.id] }),
}));
