import { relations, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authUser } from './auth_user.js';

export type AffiliateProgramStatus = 'active' | 'paused' | 'ended';
export type AffiliatePartnerStatus = 'invited' | 'active' | 'suspended' | 'revoked';
export type AffiliateCampaignStatus = 'draft' | 'active' | 'paused' | 'ended';
export type AffiliateAttributionKind = 'click' | 'visit' | 'identity_stitch';
export type AffiliateConversionKind = 'subscription_started' | 'subscription_renewed' | 'subscription_refunded';
export type AffiliateCommissionEventKind = 'accrued' | 'approved' | 'reversed' | 'held' | 'exported' | 'paid';
export type AffiliateHoldReason = 'fraud_suspected' | 'chargeback' | 'self_referral' | 'terms_violation';
export type AffiliateHoldState = 'open' | 'resolved';

/** Platform-owned program configuration. It deliberately has no tenant/org id. */
export const affiliateProgram = pgTable('affiliate_program', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  status: text('status').$type<AffiliateProgramStatus>().notNull().default('active'),
  termsVersion: text('terms_version').notNull(),
  defaultCommissionBps: integer('default_commission_bps').notNull().default(2000),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, () => [
  check('affiliate_program_status_check', sql`status IN ('active', 'paused', 'ended')`),
  check('affiliate_program_commission_bps_check', sql`default_commission_bps BETWEEN 0 AND 10000`),
]);

/** Platform-level partner identity. Partner records never carry an org/tenant id. */
export const affiliatePartner = pgTable('affiliate_partner', {
  id: uuid('id').primaryKey().defaultRandom(),
  programId: uuid('program_id').notNull().references(() => affiliateProgram.id, { onDelete: 'restrict' }),
  displayName: text('display_name').notNull(),
  email: text('email').notNull(),
  status: text('status').$type<AffiliatePartnerStatus>().notNull().default('invited'),
  termsVersion: text('terms_version'),
  disclosureAcceptedAt: timestamp('disclosure_accepted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('affiliate_partner_program_email_unique').on(table.programId, table.email),
  index('affiliate_partner_program_status').on(table.programId, table.status),
  check('affiliate_partner_status_check', sql`status IN ('invited', 'active', 'suspended', 'revoked')`),
  check('affiliate_partner_display_name_bound', sql`char_length(btrim(display_name)) BETWEEN 1 AND 160`),
  check('affiliate_partner_email_bound', sql`char_length(btrim(email)) BETWEEN 3 AND 320`),
]);

export const affiliateCampaign = pgTable('affiliate_campaign', {
  id: uuid('id').primaryKey().defaultRandom(),
  programId: uuid('program_id').notNull().references(() => affiliateProgram.id, { onDelete: 'restrict' }),
  partnerId: uuid('partner_id').notNull().references(() => affiliatePartner.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  referralToken: text('referral_token').notNull().unique(),
  status: text('status').$type<AffiliateCampaignStatus>().notNull().default('draft'),
  commissionBps: integer('commission_bps').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('affiliate_campaign_program_slug_unique').on(table.programId, table.slug),
  index('affiliate_campaign_partner_status').on(table.partnerId, table.status),
  check('affiliate_campaign_status_check', sql`status IN ('draft', 'active', 'paused', 'ended')`),
  check('affiliate_campaign_commission_bps_check', sql`commission_bps BETWEEN 0 AND 10000`),
  check('affiliate_campaign_slug_check', sql`slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'`),
]);

/** Append-only click/visit/identity attribution facts. */
export const affiliateAttributionEvent = pgTable('affiliate_attribution_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  programId: uuid('program_id').notNull().references(() => affiliateProgram.id, { onDelete: 'restrict' }),
  campaignId: uuid('campaign_id').notNull().references(() => affiliateCampaign.id, { onDelete: 'restrict' }),
  partnerId: uuid('partner_id').notNull().references(() => affiliatePartner.id, { onDelete: 'restrict' }),
  kind: text('kind').$type<AffiliateAttributionKind>().notNull(),
  eventKey: text('event_key').notNull(),
  visitorHash: text('visitor_hash'),
  creatorUserId: text('creator_user_id').references(() => authUser.id, { onDelete: 'set null' }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('affiliate_attribution_event_key_unique').on(table.eventKey),
  index('affiliate_attribution_campaign_kind').on(table.campaignId, table.kind, table.occurredAt),
  check('affiliate_attribution_kind_check', sql`kind IN ('click', 'visit', 'identity_stitch')`),
]);

/** Immutable platform conversion facts; refund is a new fact, never an update. */
export const affiliateConversion = pgTable('affiliate_conversion', {
  id: uuid('id').primaryKey().defaultRandom(),
  programId: uuid('program_id').notNull().references(() => affiliateProgram.id, { onDelete: 'restrict' }),
  campaignId: uuid('campaign_id').notNull().references(() => affiliateCampaign.id, { onDelete: 'restrict' }),
  partnerId: uuid('partner_id').notNull().references(() => affiliatePartner.id, { onDelete: 'restrict' }),
  creatorUserId: text('creator_user_id').references(() => authUser.id, { onDelete: 'set null' }),
  kind: text('kind').$type<AffiliateConversionKind>().notNull(),
  amountCents: integer('amount_cents').notNull(),
  billingEventKey: text('billing_event_key').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('affiliate_conversion_billing_key_unique').on(table.billingEventKey),
  index('affiliate_conversion_campaign_time').on(table.campaignId, table.occurredAt),
  check('affiliate_conversion_kind_check', sql`kind IN ('subscription_started', 'subscription_renewed', 'subscription_refunded')`),
  check('affiliate_conversion_amount_check', sql`amount_cents >= 0`),
]);

/** Append-only commission state events. Balances are derived from this ledger. */
export const affiliateCommissionEvent = pgTable('affiliate_commission_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  programId: uuid('program_id').notNull().references(() => affiliateProgram.id, { onDelete: 'restrict' }),
  campaignId: uuid('campaign_id').notNull().references(() => affiliateCampaign.id, { onDelete: 'restrict' }),
  partnerId: uuid('partner_id').notNull().references(() => affiliatePartner.id, { onDelete: 'restrict' }),
  conversionId: uuid('conversion_id').notNull().references(() => affiliateConversion.id, { onDelete: 'restrict' }),
  kind: text('kind').$type<AffiliateCommissionEventKind>().notNull(),
  amountCents: integer('amount_cents').notNull(),
  eventKey: text('event_key').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('affiliate_commission_event_key_unique').on(table.eventKey),
  index('affiliate_commission_partner_state').on(table.partnerId, table.kind, table.createdAt),
  check('affiliate_commission_kind_check', sql`kind IN ('accrued', 'approved', 'reversed', 'held', 'exported', 'paid')`),
  check('affiliate_commission_amount_check', sql`amount_cents >= 0`),
]);

export const affiliateHold = pgTable('affiliate_hold', {
  id: uuid('id').primaryKey().defaultRandom(),
  programId: uuid('program_id').notNull().references(() => affiliateProgram.id, { onDelete: 'restrict' }),
  partnerId: uuid('partner_id').notNull().references(() => affiliatePartner.id, { onDelete: 'restrict' }),
  commissionId: uuid('commission_id').references(() => affiliateCommissionEvent.id, { onDelete: 'restrict' }),
  reason: text('reason').$type<AffiliateHoldReason>().notNull(),
  state: text('state').$type<AffiliateHoldState>().notNull().default('open'),
  resolvedByUserId: text('resolved_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, table => [
  index('affiliate_hold_partner_state').on(table.partnerId, table.state),
  check('affiliate_hold_reason_check', sql`reason IN ('fraud_suspected', 'chargeback', 'self_referral', 'terms_violation')`),
  check('affiliate_hold_state_check', sql`state IN ('open', 'resolved')`),
]);

export const affiliatePayoutExport = pgTable('affiliate_payout_export', {
  id: uuid('id').primaryKey().defaultRandom(),
  programId: uuid('program_id').notNull().references(() => affiliateProgram.id, { onDelete: 'restrict' }),
  partnerId: uuid('partner_id').notNull().references(() => affiliatePartner.id, { onDelete: 'restrict' }),
  commissionIds: jsonb('commission_ids').$type<string[]>().notNull(),
  totalCents: integer('total_cents').notNull(),
  exportFormat: text('export_format').notNull().default('csv'),
  createdByUserId: text('created_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, () => [
  check('affiliate_payout_export_format_check', sql`export_format = 'csv'`),
  check('affiliate_payout_export_total_check', sql`total_cents >= 0`),
]);

export const affiliateAuditEvent = pgTable('affiliate_audit_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  programId: uuid('program_id').notNull().references(() => affiliateProgram.id, { onDelete: 'restrict' }),
  actorUserId: text('actor_user_id').references(() => authUser.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  target: text('target').notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  idempotencyKey: text('idempotency_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('affiliate_audit_idempotency_unique').on(table.idempotencyKey),
  index('affiliate_audit_program_time').on(table.programId, table.createdAt),
]);

export const affiliateProgramRelations = relations(affiliateProgram, ({ many }) => ({
  partners: many(affiliatePartner),
  campaigns: many(affiliateCampaign),
  attributionEvents: many(affiliateAttributionEvent),
  conversions: many(affiliateConversion),
  commissionEvents: many(affiliateCommissionEvent),
  holds: many(affiliateHold),
  payoutExports: many(affiliatePayoutExport),
  auditEvents: many(affiliateAuditEvent),
}));

export const affiliatePartnerRelations = relations(affiliatePartner, ({ one, many }) => ({
  program: one(affiliateProgram, { fields: [affiliatePartner.programId], references: [affiliateProgram.id] }),
  campaigns: many(affiliateCampaign),
  attributionEvents: many(affiliateAttributionEvent),
  conversions: many(affiliateConversion),
  commissionEvents: many(affiliateCommissionEvent),
  holds: many(affiliateHold),
  payoutExports: many(affiliatePayoutExport),
}));

export const affiliateCampaignRelations = relations(affiliateCampaign, ({ one, many }) => ({
  program: one(affiliateProgram, { fields: [affiliateCampaign.programId], references: [affiliateProgram.id] }),
  partner: one(affiliatePartner, { fields: [affiliateCampaign.partnerId], references: [affiliatePartner.id] }),
  attributionEvents: many(affiliateAttributionEvent),
  conversions: many(affiliateConversion),
  commissionEvents: many(affiliateCommissionEvent),
}));

export const affiliateAttributionEventRelations = relations(affiliateAttributionEvent, ({ one }) => ({
  program: one(affiliateProgram, { fields: [affiliateAttributionEvent.programId], references: [affiliateProgram.id] }),
  campaign: one(affiliateCampaign, { fields: [affiliateAttributionEvent.campaignId], references: [affiliateCampaign.id] }),
  partner: one(affiliatePartner, { fields: [affiliateAttributionEvent.partnerId], references: [affiliatePartner.id] }),
  creator: one(authUser, { fields: [affiliateAttributionEvent.creatorUserId], references: [authUser.id] }),
}));

export const affiliateConversionRelations = relations(affiliateConversion, ({ one, many }) => ({
  program: one(affiliateProgram, { fields: [affiliateConversion.programId], references: [affiliateProgram.id] }),
  campaign: one(affiliateCampaign, { fields: [affiliateConversion.campaignId], references: [affiliateCampaign.id] }),
  partner: one(affiliatePartner, { fields: [affiliateConversion.partnerId], references: [affiliatePartner.id] }),
  creator: one(authUser, { fields: [affiliateConversion.creatorUserId], references: [authUser.id] }),
  commissionEvents: many(affiliateCommissionEvent),
}));

export const affiliateCommissionEventRelations = relations(affiliateCommissionEvent, ({ one, many }) => ({
  program: one(affiliateProgram, { fields: [affiliateCommissionEvent.programId], references: [affiliateProgram.id] }),
  campaign: one(affiliateCampaign, { fields: [affiliateCommissionEvent.campaignId], references: [affiliateCampaign.id] }),
  partner: one(affiliatePartner, { fields: [affiliateCommissionEvent.partnerId], references: [affiliatePartner.id] }),
  conversion: one(affiliateConversion, { fields: [affiliateCommissionEvent.conversionId], references: [affiliateConversion.id] }),
  holds: many(affiliateHold),
}));

export const affiliateHoldRelations = relations(affiliateHold, ({ one }) => ({
  program: one(affiliateProgram, { fields: [affiliateHold.programId], references: [affiliateProgram.id] }),
  partner: one(affiliatePartner, { fields: [affiliateHold.partnerId], references: [affiliatePartner.id] }),
  commission: one(affiliateCommissionEvent, { fields: [affiliateHold.commissionId], references: [affiliateCommissionEvent.id] }),
  resolvedBy: one(authUser, { fields: [affiliateHold.resolvedByUserId], references: [authUser.id] }),
}));

export const affiliatePayoutExportRelations = relations(affiliatePayoutExport, ({ one }) => ({
  program: one(affiliateProgram, { fields: [affiliatePayoutExport.programId], references: [affiliateProgram.id] }),
  partner: one(affiliatePartner, { fields: [affiliatePayoutExport.partnerId], references: [affiliatePartner.id] }),
  createdBy: one(authUser, { fields: [affiliatePayoutExport.createdByUserId], references: [authUser.id] }),
}));

export const affiliateAuditEventRelations = relations(affiliateAuditEvent, ({ one }) => ({
  program: one(affiliateProgram, { fields: [affiliateAuditEvent.programId], references: [affiliateProgram.id] }),
  actor: one(authUser, { fields: [affiliateAuditEvent.actorUserId], references: [authUser.id] }),
}));
