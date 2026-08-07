import { pgTable, uuid, text, timestamp, boolean, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const org = pgTable('org', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logoUrl: text('logo_url'),
  kekId: text('kek_id').notNull().default('egress-dek'),
  settings: jsonb('settings').$type<Record<string, unknown>>().default({}),
  features: jsonb('features').$type<string[]>().default([]),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orgRelations = relations(org, ({ many }) => ({
  users: many(appUser),
  profiles: many(modelProfile),
  connections: many(platformConnection),
  bundles: many(contentBundle),
  auditLogs: many(auditLog),
}));

// Forward declarations for circular refs
import { appUser } from './app_user.js';
import { modelProfile } from './model_profile.js';
import { platformConnection } from './platform_connection.js';
import { contentBundle } from './content_bundle.js';
import { auditLog } from './audit_log.js';
