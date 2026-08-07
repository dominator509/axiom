import { pgTable, uuid, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';

export const orgSettings = pgTable('org_settings', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => org.id, { onDelete: 'cascade' }),
  publishingEnabled: boolean('publishing_enabled').notNull().default(true),
  // F-86 (L2.8 §8): opt-in cross-model pattern sharing within the org.
  viralSharing: boolean('viral_sharing').notNull().default(false),
  killSwitchReason: text('kill_switch_reason'),
  killSwitchActor: text('kill_switch_actor'),
  killSwitchAt: timestamp('kill_switch_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orgSettingsRelations = relations(orgSettings, ({ one }) => ({
  org: one(org, {
    fields: [orgSettings.orgId],
    references: [org.id],
  }),
}));
