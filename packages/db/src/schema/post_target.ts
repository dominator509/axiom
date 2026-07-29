import { pgTable, uuid, text, timestamp, bytea } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const postTarget = pgTable('post_target', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => import('./org.js').org.id),
  bundleId: uuid('bundle_id').notNull().references(() => import('./content_bundle.js').contentBundle.id),
  platform: text('platform').notNull(),
  connectionId: uuid('connection_id'),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  state: text('state').notNull().default('pending'),
  remoteId: text('remote_id'),
  error: text('error'),
  idemKey: bytea('idem_key'),
});

export const postTargetRelations = relations(postTarget, ({ one }) => ({
  org: one(import('./org.js').org, {
    fields: [postTarget.orgId],
    references: [import('./org.js').org.id],
  }),
  bundle: one(import('./content_bundle.js').contentBundle, {
    fields: [postTarget.bundleId],
    references: [import('./content_bundle.js').contentBundle.id],
  }),
  connection: one(import('./platform_connection.js').platformConnection, {
    fields: [postTarget.connectionId],
    references: [import('./platform_connection.js').platformConnection.id],
  }),
}));
