import { pgTable, uuid, text, timestamp, jsonb, bytea } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => import('./org.js').org.id),
  actorRef: text('actor_ref').notNull(),
  action: text('action').notNull(),
  target: text('target').notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>().default({}),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  prevHash: bytea('prev_hash').notNull(),
  rowHash: bytea('row_hash').notNull(),
});

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  org: one(import('./org.js').org, {
    fields: [auditLog.orgId],
    references: [import('./org.js').org.id],
  }),
}));
