// ─── FanThynks platform affiliate/referral contract (F-90) ────────────────
//
// This is the FanThynks/Axiom platform-owned SaaS referral program: partners
// refer CREATORS to FanThynks and earn tracked commissions. It is NOT a
// tenant-facing affiliate builder, creator referral feature, provider-earnings
// referral, or resale control plane.
//
// Pure domain contract: no billing, payout, provider or publication side effect
// exists here. Every money/effect boundary is an explicit, separate, approvable
// fence (L3.0 F-90). Attribution events are immutable; commission and payout
// views are derived and recomputable.

export type PartnerStatus = 'invited' | 'active' | 'suspended' | 'revoked';
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'ended';
export type ConversionKind = 'subscription_started' | 'subscription_renewed' | 'subscription_refunded';
export type CommissionState = 'accrued' | 'approved' | 'reversed' | 'held' | 'exported';
export type HoldReason = 'fraud_suspected' | 'chargeback' | 'self_referral' | 'terms_violation';
export type PayoutState = 'pending_review' | 'approved' | 'exported' | 'paid';

/** Opaque provider/customer identifiers are tenant-scoped and never partner-visible. */
export interface Partner {
  partnerId: string;
  /** Platform-level, not org-level: partners are FanThynks-side. */
  displayName: string;
  email: string;
  status: PartnerStatus;
  /** Disclosure acceptance is mandatory before any link is active. */
  disclosureAcceptedAt?: string;
  termsVersion: string;
}

export interface Campaign {
  campaignId: string;
  partnerId: string;
  name: string;
  slug: string;
  status: CampaignStatus;
  /** Commission basis points of referred SaaS revenue. */
  commissionBps: number;
  createdAt: string;
}

export interface ReferralLink {
  linkId: string;
  campaignId: string;
  /** Opaque, non-guessable token embedded in the URL. */
  token: string;
  createdAt: string;
  revokedAt?: string;
}

/** An immutable click/visit record. Never mutated; corrections are new events. */
export interface ClickEvent {
  eventId: string;
  linkId: string;
  campaignId: string;
  occurredAt: string;
  /** Coarse, non-PII fingerprint for deduplication and fraud review. */
  fingerprint: string;
}

/**
 * An immutable identity stitch binding a prior click to a referred creator.
 * The referred creator's identity is stored opaque; it is never exposed to a
 * partner beyond aggregate attribution.
 */
export interface IdentityStitch {
  stitchId: string;
  clickEventId: string;
  campaignId: string;
  /** Opaque referred-creator reference — not a customer or tenant record. */
  referredCreatorRef: string;
  stitchedAt: string;
  /** The window within which the stitch is attributed to the click. */
  attributionWindowDays: number;
}

/** A clearly identified SaaS conversion for a referred creator. */
export interface ConversionEvent {
  conversionId: string;
  stitchId: string;
  campaignId: string;
  kind: ConversionKind;
  /** Positive for new/renewal, positive amount flagged as a reversal input. */
  amountCents: number;
  occurredAt: string;
  /** Idempotency key from the billing fence that produced this event. */
  billingIdempotencyKey: string;
}

export interface CommissionRecord {
  commissionId: string;
  conversionId: string;
  partnerId: string;
  campaignId: string;
  amountCents: number;
  state: CommissionState;
  accruedAt: string;
  /** Set when state becomes 'reversed'. */
  reversedAt?: string;
  reversalReason?: string;
  /** Set when state becomes 'held'. */
  holdId?: string;
}

export interface FraudHold {
  holdId: string;
  partnerId: string;
  reason: HoldReason;
  openedAt: string;
  note?: string;
  resolvedAt?: string;
  resolution?: 'released' | 'upheld';
}

export interface PayoutBatch {
  batchId: string;
  partnerId: string;
  commissionIds: string[];
  totalCents: number;
  state: PayoutState;
  createdAt: string;
  /** Export is a file boundary, never a live transfer (L3.0 F-90). */
  exportFormat: 'csv';
}

// ─── Validation ───────────────────────────────────────────────────────────

export function isValidCommissionBps(bps: number): boolean {
  return Number.isInteger(bps) && bps >= 0 && bps <= 10_000;
}

/** A referral token must be long and URL-safe so it cannot be guessed. */
export function isValidReferralToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{24,128}$/.test(token);
}

/** A slug is lowercase, bounded and URL-safe. */
export function isValidCampaignSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug);
}

/** Attribution is only valid inside the declared click-to-stitch window. */
export function isWithinAttributionWindow(
  clickAt: string,
  stitchedAt: string,
  windowDays: number,
): boolean {
  if (!Number.isInteger(windowDays) || windowDays < 0) return false;
  const click = Date.parse(clickAt);
  const stitch = Date.parse(stitchedAt);
  if (!Number.isFinite(click) || !Number.isFinite(stitch)) return false;
  if (stitch < click) return false;
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  return stitch - click <= windowMs;
}

/**
 * Deterministically pick the winning stitch for a same-creator, same-campaign
 * situation: LAST click wins within the window (documented, recomputable rule).
 */
export function selectWinningStitch(
  stitches: IdentityStitch[],
  clicks: Map<string, ClickEvent>,
): IdentityStitch | undefined {
  const valid = stitches.filter((stitch) => {
    const click = clicks.get(stitch.clickEventId);
    if (!click) return false;
    return isWithinAttributionWindow(click.occurredAt, stitch.stitchedAt, stitch.attributionWindowDays);
  });
  if (valid.length === 0) return undefined;
  return valid.reduce((latest, current) => {
    const clickLatest = clicks.get(latest.clickEventId)!;
    const clickCurrent = clicks.get(current.clickEventId)!;
    return Date.parse(clickCurrent.occurredAt) > Date.parse(clickLatest.occurredAt) ? current : latest;
  });
}

/** Commission in cents from an amount and basis points. Rounds half-up. */
export function commissionCents(amountCents: number, commissionBps: number): number {
  if (!Number.isInteger(amountCents) || amountCents < 0) throw new Error('amount must be a non-negative integer');
  if (!isValidCommissionBps(commissionBps)) throw new Error('invalid commission basis points');
  return Math.round((amountCents * commissionBps) / 10_000);
}

/**
 * Accrual is derived from immutable conversion events. A refund/chargeback
 * produces a reversal, never a mutation of the original accrual.
 */
export function deriveCommission(
  conversion: ConversionEvent,
  commissionBps: number,
  partnerId: string,
): CommissionRecord {
  const base = {
    commissionId: `comm_${conversion.conversionId}`,
    conversionId: conversion.conversionId,
    partnerId,
    campaignId: conversion.campaignId,
    amountCents: commissionCents(conversion.amountCents, commissionBps),
    accruedAt: conversion.occurredAt,
  };
  if (conversion.kind === 'subscription_refunded') {
    return { ...base, state: 'reversed', reversedAt: conversion.occurredAt, reversalReason: 'refund' };
  }
  return { ...base, state: 'accrued' };
}

/**
 * A commission can only move along the documented state machine. Money-moving
 * transitions (exported/paid) require a separate approval fence.
 */
export function canTransitionCommission(from: CommissionState, to: CommissionState): boolean {
  const allowed: Record<CommissionState, CommissionState[]> = {
    accrued: ['approved', 'reversed', 'held'],
    approved: ['reversed', 'held', 'exported'],
    held: ['approved', 'reversed'],
    reversed: [],
    exported: [],
  };
  return from === to || allowed[from].includes(to);
}

/** A held commission cannot be exported until the hold is resolved. */
export function isCommissionExportable(commission: CommissionRecord, holds: FraudHold[]): boolean {
  if (commission.state !== 'approved') return false;
  const open = holds.some((hold) => hold.partnerId === commission.partnerId && !hold.resolvedAt);
  return !open;
}

// ─── Payout export ────────────────────────────────────────────────────────

export interface PayoutExportRow {
  partnerId: string;
  partnerName: string;
  commissionId: string;
  amountCents: number;
  accruedAt: string;
}

/**
 * Build a payout export. Export produces a FILE only — it never transfers
 * money, and it never bypasses the approval fence.
 */
export function buildPayoutExport(
  partner: Partner,
  commissions: CommissionRecord[],
  holds: FraudHold[],
): { batch: PayoutBatch; csv: string } {
  const eligible = commissions.filter((c) => c.partnerId === partner.partnerId && isCommissionExportable(c, holds));
  const totalCents = eligible.reduce((sum, c) => sum + c.amountCents, 0);
  const batch: PayoutBatch = {
    batchId: `batch_${partner.partnerId}_${eligible.length}`,
    partnerId: partner.partnerId,
    commissionIds: eligible.map((c) => c.commissionId),
    totalCents,
    state: 'pending_review',
    createdAt: new Date(0).toISOString(),
    exportFormat: 'csv',
  };
  const header = 'partner_id,partner_name,commission_id,amount_cents,accrued_at';
  const lines = eligible.map((c) => [
    csvCell(partner.partnerId),
    csvCell(partner.displayName),
    csvCell(c.commissionId),
    String(c.amountCents),
    csvCell(c.accruedAt),
  ].join(','));
  return { batch, csv: [header, ...lines].join('\n') };
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// ─── Partner-visible projection ───────────────────────────────────────────

/**
 * The ONLY record shape a partner may see. It carries attribution and payout
 * aggregates for the partner's own campaigns and nothing else — no creator or
 * customer data, no credentials, no cross-partner rows.
 */
export interface PartnerVisibleSummary {
  partnerId: string;
  campaignId: string;
  clicks: number;
  conversions: number;
  accruedCents: number;
  reversedCents: number;
  exportableCents: number;
  holdsOpen: number;
}

/**
 * Project partner-visible aggregates. Any row whose partnerId differs is
 * dropped — a partner can never observe another partner's attribution.
 */
export function partnerVisibleSummary(
  requestingPartnerId: string,
  campaignId: string,
  input: {
    /** Campaign rows are the authoritative ownership boundary for the projection. */
    campaigns: Campaign[];
    clicks: ClickEvent[];
    conversions: ConversionEvent[];
    commissions: CommissionRecord[];
    holds: FraudHold[];
  },
): PartnerVisibleSummary {
  const commissionScope = input.commissions.filter(
    (c) => c.partnerId === requestingPartnerId && c.campaignId === campaignId,
  );
  const ownsCampaign = input.campaigns.some(
    (campaign) => campaign.campaignId === campaignId && campaign.partnerId === requestingPartnerId,
  );
  const scopedCommissions = ownsCampaign ? commissionScope : [];
  const scopedHolds = ownsCampaign
    ? input.holds.filter((hold) => hold.partnerId === requestingPartnerId && !hold.resolvedAt)
    : [];
  return {
    partnerId: requestingPartnerId,
    campaignId,
    clicks: ownsCampaign
      ? input.clicks.filter((click) => click.campaignId === campaignId).length
      : 0,
    conversions: ownsCampaign
      ? input.conversions.filter((conv) => conv.campaignId === campaignId).length
      : 0,
    accruedCents: scopedCommissions.filter((c) => c.state === 'accrued' || c.state === 'approved')
      .reduce((sum, c) => sum + c.amountCents, 0),
    reversedCents: scopedCommissions.filter((c) => c.state === 'reversed')
      .reduce((sum, c) => sum + c.amountCents, 0),
    exportableCents: scopedCommissions.filter((c) => isCommissionExportable(c, input.holds))
      .reduce((sum, c) => sum + c.amountCents, 0),
    holdsOpen: scopedHolds.length,
  };
}

/**
 * Explicit proof that a projection carries no creator/customer fields. Used by
 * tests and by the API layer before serializing a partner response.
 */
export function containsCreatorOrCustomerData(value: unknown): boolean {
  const forbidden = ['email', 'customerId', 'creatorId', 'referredCreatorRef', 'tenantId', 'orgId', 'accessToken'];
  const serialized = JSON.stringify(value);
  return forbidden.some((field) => serialized.includes(field));
}

// ─── Idempotency ──────────────────────────────────────────────────────────

/** Claim a provider/attribution event exactly once. */
export function claimAttributionEvent(seen: Set<string>, eventKey: string): boolean {
  if (typeof eventKey !== 'string' || eventKey.length === 0) return false;
  if (seen.has(eventKey)) return false;
  seen.add(eventKey);
  return true;
}

/**
 * Reconcile conversions against the immutable event log. A billing idempotency
 * key seen twice is the same conversion, not a new accrual.
 */
export function reconcileConversions(
  events: ConversionEvent[],
  seen: Set<string>,
): { accepted: ConversionEvent[]; duplicates: ConversionEvent[] } {
  const accepted: ConversionEvent[] = [];
  const duplicates: ConversionEvent[] = [];
  for (const event of events) {
    if (claimAttributionEvent(seen, event.billingIdempotencyKey)) accepted.push(event);
    else duplicates.push(event);
  }
  return { accepted, duplicates };
}

// ─── Disclosure / consent and deletion ────────────────────────────────────

export function canActivateCampaign(partner: Partner, campaign: Campaign): boolean {
  if (!partner.disclosureAcceptedAt) return false;
  if (partner.status !== 'active') return false;
  if (campaign.partnerId !== partner.partnerId) return false;
  return campaign.status === 'active';
}

export interface PartnerDataExport {
  partner: Partner;
  campaigns: Campaign[];
  commissions: CommissionRecord[];
}

/** Export everything held about a partner. Never includes referred-creator data. */
export function exportPartnerData(partner: Partner, campaigns: Campaign[], commissions: CommissionRecord[]): PartnerDataExport {
  return {
    partner,
    campaigns: campaigns.filter((c) => c.partnerId === partner.partnerId),
    commissions: commissions.filter((c) => c.partnerId === partner.partnerId),
  };
}

/** Soft-delete a partner: revoke, not erase audit-bearing attribution. */
export function revokePartner(partner: Partner): Partner {
  return { ...partner, status: 'revoked' };
}

/** Bounded page for operator surfaces, mirroring the platform pattern. */
export function paginatePartners<T extends { partnerId: string }>(rows: T[], pageSize = 50): { data: T[]; nextCursor: string | null } {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('invalid page size');
  const hasMore = rows.length > pageSize;
  const data = rows.slice(0, pageSize);
  return { data, nextCursor: hasMore ? data[data.length - 1].partnerId : null };
}
