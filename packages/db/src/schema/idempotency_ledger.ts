import { pgTable, uuid, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';

export const idempotencyLedger = pgTable('idempotency_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id),
  idemKey: text('idem_key').notNull().unique(),
  responseHash: text('response_hash'),
  locked: boolean('locked').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const idempotencyLedgerRelations = relations(idempotencyLedger, ({ one }) => ({
  org: one(org, {
    fields: [idempotencyLedger.orgId],
    references: [org.id],
  }),
}));
