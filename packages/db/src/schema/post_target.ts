import { pgTable, uuid, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { contentBundle } from './content_bundle.js';
import { platformConnection } from './platform_connection.js';
import { bytea } from './types.js';

export const postTarget = pgTable(
  'post_target',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => org.id),
    bundleId: uuid('bundle_id')
      .notNull()
      .references(() => contentBundle.id),
    platform: text('platform').notNull(),
    connectionId: uuid('connection_id'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    state: text('state').notNull().default('pending'),
    remoteId: text('remote_id'),
    error: text('error'),
    // Idempotency key = H(model_id, asset_sha, platform, slot) (LBI-05).
    // NOT NULL + unique (org_id, idem_key) makes double-publish structurally
    // impossible (L3.1 §11) — enforced in migration 0005.
    idemKey: bytea('idem_key').notNull(),
  },
  (table) => [uniqueIndex('post_target_org_idem_key_unique').on(table.orgId, table.idemKey)],
);

export const postTargetRelations = relations(postTarget, ({ one }) => ({
  org: one(org, {
    fields: [postTarget.orgId],
    references: [org.id],
  }),
  bundle: one(contentBundle, {
    fields: [postTarget.bundleId],
    references: [contentBundle.id],
  }),
  connection: one(platformConnection, {
    fields: [postTarget.connectionId],
    references: [platformConnection.id],
  }),
}));
