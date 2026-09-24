import { pgTable, uuid, text, integer, timestamp, unique, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { shortLink } from './short_link.js';

/** Explicitly recorded campaign spend, kept separate from attributed revenue. */
export const linkbioCampaignCost = pgTable('linkbio_campaign_cost', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  shortLinkId: uuid('short_link_id').notNull().references(() => shortLink.id, { onDelete: 'cascade' }),
  eventKey: text('event_key').notNull(),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull().default('USD'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  recordedByUserId: text('recorded_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('linkbio_campaign_cost_key_unique').on(table.orgId, table.eventKey),
  index('linkbio_campaign_cost_model_time').on(table.orgId, table.modelId, table.occurredAt),
  index('linkbio_campaign_cost_link_time').on(table.shortLinkId, table.occurredAt),
  check('linkbio_campaign_cost_amount_check', sql`${table.amountCents} >= 0`),
  check('linkbio_campaign_cost_currency_check', sql`${table.currency} ~ '^[A-Z]{3}$'`),
]);
