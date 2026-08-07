import { pgTable, uuid, text, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';

// F-73 (L2.9): Sentry/GlitchTip-style crash sink. Grouped by (org, fingerprint);
// a recurring bug is one row whose `count` grows. last_seen is timestamp(3) for
// keyset cursor stability (the precision rule).
export const crashReport = pgTable('crash_report', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id, { onDelete: 'cascade' }),
  fingerprint: text('fingerprint').notNull(),
  eventId: text('event_id').notNull(),
  service: text('service').notNull(),
  release: text('release').notNull().default('unknown'),
  environment: text('environment').notNull().default('production'),
  message: text('message').notNull().default(''),
  stacktrace: jsonb('stacktrace').$type<Array<Record<string, unknown>>>().notNull().default([]),
  correlationId: text('correlation_id'),
  severity: text('severity')
    .$type<'sev-1' | 'sev-2' | 'sev-3' | 'sev-4'>()
    .notNull()
    .default('sev-3'),
  status: text('status')
    .$type<'open' | 'resolved' | 'ignored'>()
    .notNull()
    .default('open'),
  count: integer('count').notNull().default(1),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
});

export const crashReportRelations = relations(crashReport, ({ one }) => ({
  org: one(org, {
    fields: [crashReport.orgId],
    references: [org.id],
  }),
}));
