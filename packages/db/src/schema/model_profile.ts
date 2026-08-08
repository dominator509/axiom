import { pgTable, uuid, text, timestamp, boolean } from 'drizzle-orm/pg-core';
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
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const modelProfileRelations = relations(modelProfile, ({ one, many }) => ({
  org: one(org, {
    fields: [modelProfile.orgId],
    references: [org.id],
  }),
  connections: many(platformConnection),
  bundles: many(contentBundle),
}));
