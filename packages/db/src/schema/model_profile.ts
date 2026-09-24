import { pgTable, uuid, text, timestamp, boolean, integer, unique } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { platformConnection } from './platform_connection.js';
import { contentBundle } from './content_bundle.js';

export const modelProfile = pgTable('model_profile', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id),
  displayName: text('display_name').notNull(),
  handle: text('handle').notNull(),
  avatarUrl: text('avatar_url'),
  bio: text('bio'),
  // F-42: owner-configured public funnel destination. The API accepts only
  // private Telegram or Discord invite URLs before persisting this value.
  publicCommunityInviteUrl: text('public_community_invite_url'),
  characterLockPrompt: text('character_lock_prompt').notNull().default(''),
  characterLockVersion: integer('character_lock_version').notNull().default(0),
  // F-85 recurring Relay insight schedule. Null is opt-out and also acts as
  // the generation token for invalidating already-queued occurrences.
  viralInsightScheduleId: uuid('viral_insight_schedule_id'),
  // F-86 requires explicit per-model consent before abstract org-level
  // patterns can be shared or received. Raw model content remains scoped.
  viralPatternSharingEnabled: boolean('viral_pattern_sharing_enabled').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [unique('model_profile_org_identity').on(table.orgId, table.id)]);

export const modelProfileRelations = relations(modelProfile, ({ one, many }) => ({
  org: one(org, {
    fields: [modelProfile.orgId],
    references: [org.id],
  }),
  connections: many(platformConnection),
  bundles: many(contentBundle),
}));
