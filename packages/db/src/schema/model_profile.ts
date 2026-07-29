import { pgTable, uuid, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const modelProfile = pgTable('model_profile', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => import('./org.js').org.id),
  displayName: text('display_name').notNull(),
  handle: text('handle').notNull(),
  avatarUrl: text('avatar_url'),
  bio: text('bio'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const modelProfileRelations = relations(modelProfile, ({ one, many }) => ({
  org: one(import('./org.js').org, {
    fields: [modelProfile.orgId],
    references: [import('./org.js').org.id],
  }),
  connections: many(platformConnection),
  bundles: many(contentBundle),
}));

import { platformConnection } from './platform_connection.js';
import { contentBundle } from './content_bundle.js';
