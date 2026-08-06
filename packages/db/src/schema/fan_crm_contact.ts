import { pgTable, uuid, text, timestamp, numeric, unique } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { fanTouchpoint } from './fan_touchpoint.js';
import { customRequest } from './custom_request.js';

export const fanCrmContact = pgTable(
  'fan_crm_contact',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => org.id, { onDelete: 'cascade' }),
    modelId: uuid('model_id')
      .notNull()
      .references(() => modelProfile.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    externalId: text('external_id').notNull(),
    displayName: text('display_name'),
    tier: text('tier').notNull().default('new'),
    lifetimeValueUsd: numeric('lifetime_value_usd', { precision: 12, scale: 2 }).notNull().default('0'),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.orgId, t.modelId, t.platform, t.externalId)],
);

export const fanCrmContactRelations = relations(fanCrmContact, ({ one, many }) => ({
  org: one(org, {
    fields: [fanCrmContact.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [fanCrmContact.modelId],
    references: [modelProfile.id],
  }),
  touchpoints: many(fanTouchpoint),
  customRequests: many(customRequest),
}));
