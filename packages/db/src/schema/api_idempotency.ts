import { pgTable, uuid, text, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';

/**
 * Durable HTTP idempotency store (L3.0 / M-2). The API idempotency middleware
 * persists the replayed response here keyed by (org_id, method, route,
 * idem_key) with a 24h TTL, so a mutation's outside-world effect is replayable
 * across process restarts. RLS-scoped to the owning org (LBI-02).
 */
export const apiIdempotency = pgTable(
  'api_idempotency',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => org.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
    route: text('route').notNull(),
    idemKey: text('idem_key').notNull(),
    status: integer('status').notNull(),
    responseBody: jsonb('response_body').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, precision: 3 }).notNull(),
  },
  (t) => [t.id],
);

export const apiIdempotencyRelations = relations(apiIdempotency, ({ one }) => ({
  org: one(org, {
    fields: [apiIdempotency.orgId],
    references: [org.id],
  }),
}));
