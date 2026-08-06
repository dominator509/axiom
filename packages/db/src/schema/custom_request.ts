import { pgTable, uuid, text, timestamp, numeric } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { fanCrmContact } from './fan_crm_contact.js';

export const customRequest = pgTable('custom_request', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id')
    .notNull()
    .references(() => modelProfile.id, { onDelete: 'cascade' }),
  fanId: uuid('fan_id').references(() => fanCrmContact.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('pending'),
  priceUsd: numeric('price_usd', { precision: 12, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const customRequestRelations = relations(customRequest, ({ one }) => ({
  org: one(org, {
    fields: [customRequest.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [customRequest.modelId],
    references: [modelProfile.id],
  }),
  fan: one(fanCrmContact, {
    fields: [customRequest.fanId],
    references: [fanCrmContact.id],
  }),
}));
