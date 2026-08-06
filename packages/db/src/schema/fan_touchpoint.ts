import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { fanCrmContact } from './fan_crm_contact.js';

export const fanTouchpoint = pgTable('fan_touchpoint', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id, { onDelete: 'cascade' }),
  fanId: uuid('fan_id')
    .notNull()
    .references(() => fanCrmContact.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  kind: text('kind').notNull(),
  direction: text('direction').notNull().default('inbound'),
  content: text('content'),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
});

export const fanTouchpointRelations = relations(fanTouchpoint, ({ one }) => ({
  org: one(org, {
    fields: [fanTouchpoint.orgId],
    references: [org.id],
  }),
  fan: one(fanCrmContact, {
    fields: [fanTouchpoint.fanId],
    references: [fanCrmContact.id],
  }),
}));
