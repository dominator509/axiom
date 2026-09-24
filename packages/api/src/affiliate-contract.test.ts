// ─── FanThynks platform affiliate contract tests (F-90) ───────────────────
//
// Pure domain tests: no billing, payout, provider, deployment or hosted-license
// contact. All money effects are asserted as DERIVED records, never executed.

import { describe, expect, it } from 'vitest';
import {
  buildPayoutExport,
  canActivateCampaign,
  canTransitionCommission,
  claimAttributionEvent,
  commissionCents,
  containsCreatorOrCustomerData,
  deriveCommission,
  exportPartnerData,
  isCommissionExportable,
  isWithinAttributionWindow,
  isValidCampaignSlug,
  isValidCommissionBps,
  isValidReferralToken,
  paginatePartners,
  partnerVisibleSummary,
  reconcileConversions,
  revokePartner,
  selectWinningStitch,
  type ClickEvent,
  type Campaign,
  type CommissionRecord,
  type ConversionEvent,
  type FraudHold,
  type IdentityStitch,
  type Partner,
} from './affiliate-contract.js';

const PARTNER_A = 'partner-a';
const PARTNER_B = 'partner-b';
const CAMPAIGN = 'camp-1';

function partner(overrides: Partial<Partner> = {}): Partner {
  return {
    partnerId: PARTNER_A,
    displayName: 'Partner A',
    email: 'a@example.test',
    status: 'active',
    disclosureAcceptedAt: '2026-01-01T00:00:00Z',
    termsVersion: 'v1',
    ...overrides,
  };
}

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    campaignId: CAMPAIGN,
    partnerId: PARTNER_A,
    name: 'Launch',
    slug: 'launch',
    status: 'active',
    commissionBps: 2_000,
    createdAt: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

function click(overrides: Partial<ClickEvent> = {}): ClickEvent {
  return {
    eventId: 'click-1',
    linkId: 'link-1',
    campaignId: CAMPAIGN,
    occurredAt: '2026-02-01T00:00:00Z',
    fingerprint: 'fp-1',
    ...overrides,
  };
}

function stitch(overrides: Partial<IdentityStitch> = {}): IdentityStitch {
  return {
    stitchId: 'stitch-1',
    clickEventId: 'click-1',
    campaignId: CAMPAIGN,
    referredCreatorRef: 'creator-opaque-1',
    stitchedAt: '2026-02-02T00:00:00Z',
    attributionWindowDays: 30,
    ...overrides,
  };
}

function conversion(overrides: Partial<ConversionEvent> = {}): ConversionEvent {
  return {
    conversionId: 'conv-1',
    stitchId: 'stitch-1',
    campaignId: CAMPAIGN,
    kind: 'subscription_started',
    amountCents: 10_000,
    occurredAt: '2026-02-03T00:00:00Z',
    billingIdempotencyKey: 'bill-1',
    ...overrides,
  };
}

describe('F-90 platform program validation', () => {
  it('accepts a bounded commission rate and rejects out-of-range values', () => {
    expect(isValidCommissionBps(0)).toBe(true);
    expect(isValidCommissionBps(2_000)).toBe(true);
    expect(isValidCommissionBps(10_000)).toBe(true);
    expect(isValidCommissionBps(-1)).toBe(false);
    expect(isValidCommissionBps(10_001)).toBe(false);
    expect(isValidCommissionBps(12.5)).toBe(false);
  });

  it('requires a long, unguessable referral token', () => {
    expect(isValidReferralToken('a'.repeat(24))).toBe(true);
    expect(isValidReferralToken('short')).toBe(false);
    expect(isValidReferralToken('has spaces in it 1234567890')).toBe(false);
    expect(isValidReferralToken(12345)).toBe(false);
  });

  it('requires a lowercase url-safe campaign slug', () => {
    expect(isValidCampaignSlug('spring-launch')).toBe(true);
    expect(isValidCampaignSlug('a')).toBe(true);
    expect(isValidCampaignSlug('Spring')).toBe(false);
    expect(isValidCampaignSlug('-leading')).toBe(false);
    expect(isValidCampaignSlug('trailing-')).toBe(false);
  });
});

describe('F-90 immutable attribution', () => {
  it('accepts a stitch inside the attribution window and rejects outside it', () => {
    expect(isWithinAttributionWindow('2026-02-01T00:00:00Z', '2026-02-10T00:00:00Z', 30)).toBe(true);
    expect(isWithinAttributionWindow('2026-02-01T00:00:00Z', '2026-03-15T00:00:00Z', 30)).toBe(false);
    expect(isWithinAttributionWindow('2026-02-01T00:00:00Z', '2026-01-01T00:00:00Z', 30)).toBe(false);
  });

  it('rejects an invalid window length', () => {
    expect(isWithinAttributionWindow('2026-02-01T00:00:00Z', '2026-02-02T00:00:00Z', -1)).toBe(false);
    expect(isWithinAttributionWindow('2026-02-01T00:00:00Z', '2026-02-02T00:00:00Z', 1.5)).toBe(false);
  });

  it('selects the LAST valid click deterministically', () => {
    const clicks = new Map<string, ClickEvent>([
      ['click-1', click({ eventId: 'click-1', occurredAt: '2026-02-01T00:00:00Z' })],
      ['click-2', click({ eventId: 'click-2', occurredAt: '2026-02-05T00:00:00Z' })],
    ]);
    const stitches = [
      stitch({ stitchId: 'stitch-1', clickEventId: 'click-1', stitchedAt: '2026-02-01T12:00:00Z' }),
      stitch({ stitchId: 'stitch-2', clickEventId: 'click-2', stitchedAt: '2026-02-06T00:00:00Z' }),
    ];
    expect(selectWinningStitch(stitches, clicks)?.stitchId).toBe('stitch-2');
  });

  it('returns no winner when every stitch is outside its window', () => {
    const clicks = new Map<string, ClickEvent>([['click-1', click({ occurredAt: '2026-01-01T00:00:00Z' })]]);
    const stitches = [stitch({ stitchedAt: '2026-06-01T00:00:00Z', attributionWindowDays: 30 })];
    expect(selectWinningStitch(stitches, clicks)).toBeUndefined();
  });

  it('is recomputable: the same inputs yield the same winner', () => {
    const clicks = new Map<string, ClickEvent>([
      ['click-1', click({ eventId: 'click-1' })],
      ['click-2', click({ eventId: 'click-2', occurredAt: '2026-02-05T00:00:00Z' })],
    ]);
    const stitches = [
      stitch({ stitchId: 'stitch-1', clickEventId: 'click-1' }),
      stitch({ stitchId: 'stitch-2', clickEventId: 'click-2' }),
    ];
    const first = selectWinningStitch(stitches, clicks)?.stitchId;
    const second = selectWinningStitch([...stitches].reverse(), clicks)?.stitchId;
    expect(first).toBe(second);
  });

  it('claims an attribution event exactly once', () => {
    const seen = new Set<string>();
    expect(claimAttributionEvent(seen, 'click-1')).toBe(true);
    expect(claimAttributionEvent(seen, 'click-1')).toBe(false);
    expect(claimAttributionEvent(seen, '')).toBe(false);
  });
});

describe('F-90 commission accrual and reversal', () => {
  it('computes commission from basis points, rounding half-up', () => {
    expect(commissionCents(10_000, 2_000)).toBe(2_000);
    expect(commissionCents(333, 2_000)).toBe(67);
    expect(commissionCents(0, 2_000)).toBe(0);
  });

  it('rejects invalid amounts and rates', () => {
    expect(() => commissionCents(-5, 100)).toThrow(/non-negative/);
    expect(() => commissionCents(10.5, 100)).toThrow(/integer/);
    expect(() => commissionCents(100, 20_000)).toThrow(/basis points/);
  });

  it('accrues an immutable commission for a subscription start', () => {
    const record = deriveCommission(conversion(), 2_000, PARTNER_A);
    expect(record.state).toBe('accrued');
    expect(record.amountCents).toBe(2_000);
    expect(record.reversedAt).toBeUndefined();
  });

  it('derives a reversal for a refund instead of mutating the accrual', () => {
    const record = deriveCommission(conversion({ kind: 'subscription_refunded' }), 2_000, PARTNER_A);
    expect(record.state).toBe('reversed');
    expect(record.reversalReason).toBe('refund');
    expect(record.reversedAt).toBeDefined();
  });

  it('enforces the commission state machine and closes terminal states', () => {
    expect(canTransitionCommission('accrued', 'approved')).toBe(true);
    expect(canTransitionCommission('accrued', 'reversed')).toBe(true);
    expect(canTransitionCommission('approved', 'exported')).toBe(true);
    expect(canTransitionCommission('held', 'approved')).toBe(true);
    expect(canTransitionCommission('reversed', 'approved')).toBe(false);
    expect(canTransitionCommission('exported', 'approved')).toBe(false);
  });
});

describe('F-90 fraud holds and payout fences', () => {
  const approved: CommissionRecord = {
    commissionId: 'comm-1',
    conversionId: 'conv-1',
    partnerId: PARTNER_A,
    campaignId: CAMPAIGN,
    amountCents: 2_000,
    state: 'approved',
    accruedAt: '2026-02-03T00:00:00Z',
  };

  it('blocks export while a hold is open', () => {
    const hold: FraudHold = { holdId: 'hold-1', partnerId: PARTNER_A, reason: 'fraud_suspected', openedAt: '2026-02-04T00:00:00Z' };
    expect(isCommissionExportable(approved, [hold])).toBe(false);
  });

  it('allows export once the hold is resolved', () => {
    const hold: FraudHold = {
      holdId: 'hold-1',
      partnerId: PARTNER_A,
      reason: 'chargeback',
      openedAt: '2026-02-04T00:00:00Z',
      resolvedAt: '2026-02-05T00:00:00Z',
      resolution: 'released',
    };
    expect(isCommissionExportable(approved, [hold])).toBe(true);
  });

  it('never exports a merely accrued or reversed commission', () => {
    expect(isCommissionExportable({ ...approved, state: 'accrued' }, [])).toBe(false);
    expect(isCommissionExportable({ ...approved, state: 'reversed' }, [])).toBe(false);
    expect(isCommissionExportable({ ...approved, state: 'held', holdId: 'hold-1' }, [])).toBe(false);
  });

  it('does not let one partner\'s hold block another partner', () => {
    const otherHold: FraudHold = { holdId: 'hold-9', partnerId: PARTNER_B, reason: 'fraud_suspected', openedAt: '2026-02-04T00:00:00Z' };
    expect(isCommissionExportable(approved, [otherHold])).toBe(true);
  });
});

describe('F-90 payout export boundary', () => {
  it('produces a CSV file and never a live transfer', () => {
    const commissions: CommissionRecord[] = [{
      commissionId: 'comm-1',
      conversionId: 'conv-1',
      partnerId: PARTNER_A,
      campaignId: CAMPAIGN,
      amountCents: 2_000,
      state: 'approved',
      accruedAt: '2026-02-03T00:00:00Z',
    }];
    const { batch, csv } = buildPayoutExport(partner(), commissions, []);
    expect(batch.exportFormat).toBe('csv');
    expect(batch.state).toBe('pending_review');
    expect(batch.totalCents).toBe(2_000);
    expect(csv.split('\n')[0]).toBe('partner_id,partner_name,commission_id,amount_cents,accrued_at');
    expect(csv).toContain('comm-1');
  });

  it('excludes held and unapproved commissions from the export total', () => {
    const commissions: CommissionRecord[] = [
      { commissionId: 'c1', conversionId: 'v1', partnerId: PARTNER_A, campaignId: CAMPAIGN, amountCents: 500, state: 'accrued', accruedAt: '2026-02-03T00:00:00Z' },
      { commissionId: 'c2', conversionId: 'v2', partnerId: PARTNER_A, campaignId: CAMPAIGN, amountCents: 700, state: 'approved', accruedAt: '2026-02-03T00:00:00Z' },
    ];
    const { batch } = buildPayoutExport(partner(), commissions, []);
    expect(batch.commissionIds).toEqual(['c2']);
    expect(batch.totalCents).toBe(700);
  });

  it('escapes CSV cells that contain commas or quotes', () => {
    const partners = partner({ displayName: 'A, "Quoted" Partner' });
    const commissions: CommissionRecord[] = [{
      commissionId: 'comm-1', conversionId: 'conv-1', partnerId: PARTNER_A, campaignId: CAMPAIGN,
      amountCents: 100, state: 'approved', accruedAt: '2026-02-03T00:00:00Z',
    }];
    const { csv } = buildPayoutExport(partners, commissions, []);
    expect(csv).toContain('"A, ""Quoted"" Partner"');
  });

  it('export does not include referred-creator or customer data', () => {
    const { csv, batch } = buildPayoutExport(partner(), [], []);
    expect(containsCreatorOrCustomerData(csv)).toBe(false);
    expect(containsCreatorOrCustomerData(batch)).toBe(false);
  });
});

describe('F-90 partner isolation on read projections', () => {
  const commissions: CommissionRecord[] = [
    { commissionId: 'c-a', conversionId: 'v-a', partnerId: PARTNER_A, campaignId: CAMPAIGN, amountCents: 2_000, state: 'approved', accruedAt: '2026-02-03T00:00:00Z' },
    { commissionId: 'c-b', conversionId: 'v-b', partnerId: PARTNER_B, campaignId: CAMPAIGN, amountCents: 9_999, state: 'approved', accruedAt: '2026-02-03T00:00:00Z' },
  ];
  const conversions: ConversionEvent[] = [conversion(), conversion({ conversionId: 'conv-b', billingIdempotencyKey: 'bill-b' })];
  const clicks: ClickEvent[] = [click(), click({ eventId: 'click-b', fingerprint: 'fp-b' })];

  it('never exposes another partner\'s commissions in the summary', () => {
    const summary = partnerVisibleSummary(PARTNER_A, CAMPAIGN, { campaigns: [campaign()], clicks, conversions, commissions, holds: [] });
    expect(summary.partnerId).toBe(PARTNER_A);
    expect(summary.accruedCents).toBe(2_000);
    expect(summary.accruedCents).not.toBe(11_999);
  });

  it('excludes the other partner from a data export', () => {
    const exported = exportPartnerData(partner(), [campaign()], commissions);
    expect(exported.commissions.every((c) => c.partnerId === PARTNER_A)).toBe(true);
    expect(exported.commissions).toHaveLength(1);
  });

  it('carries no creator/customer fields in a partner summary', () => {
    const summary = partnerVisibleSummary(PARTNER_A, CAMPAIGN, { campaigns: [campaign()], clicks, conversions, commissions, holds: [] });
    expect(containsCreatorOrCustomerData(summary)).toBe(false);
    expect(Object.keys(summary)).not.toContain('referredCreatorRef');
  });

  it('reports zero for a campaign the partner does not own', () => {
    const summary = partnerVisibleSummary(PARTNER_B, 'camp-none', { campaigns: [campaign()], clicks, conversions, commissions, holds: [] });
    expect(summary.accruedCents).toBe(0);
    expect(summary.clicks).toBe(0);
  });

  it('does not infer ownership from unrelated conversion input', () => {
    const summary = partnerVisibleSummary(PARTNER_B, CAMPAIGN, {
      campaigns: [campaign()],
      clicks,
      conversions,
      commissions,
      holds: [],
    });
    expect(summary.clicks).toBe(0);
    expect(summary.conversions).toBe(0);
    expect(summary.accruedCents).toBe(0);
  });
});

describe('F-90 conversion reconciliation and idempotency', () => {
  it('accepts new conversions and flags duplicate billing keys', () => {
    const seen = new Set<string>();
    const first = reconcileConversions([conversion()], seen);
    expect(first.accepted).toHaveLength(1);
    const second = reconcileConversions([conversion()], seen);
    expect(second.accepted).toHaveLength(0);
    expect(second.duplicates).toHaveLength(1);
  });

  it('produces the same commission for a replayed event (idempotent accrual)', () => {
    const a = deriveCommission(conversion(), 2_000, PARTNER_A);
    const b = deriveCommission(conversion(), 2_000, PARTNER_A);
    expect(a).toEqual(b);
    expect(a.commissionId).toBe(b.commissionId);
  });
});

describe('F-90 disclosure, consent and partner lifecycle', () => {
  it('refuses to activate a campaign without disclosure acceptance', () => {
    const noDisclosure = partner({ disclosureAcceptedAt: undefined });
    expect(canActivateCampaign(noDisclosure, campaign())).toBe(false);
  });

  it('refuses activation for a non-active or mismatched partner', () => {
    expect(canActivateCampaign(partner({ status: 'suspended' }), campaign())).toBe(false);
    expect(canActivateCampaign(partner(), campaign({ partnerId: PARTNER_B }))).toBe(false);
  });

  it('activates only for an active, accepting, owning partner', () => {
    expect(canActivateCampaign(partner(), campaign())).toBe(true);
  });

  it('revokes rather than erasing audit-bearing attribution', () => {
    const revoked = revokePartner(partner());
    expect(revoked.status).toBe('revoked');
    expect(revoked.partnerId).toBe(PARTNER_A);
  });

  it('bounds the operator partner page', () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ partnerId: `p-${i}` }));
    const page = paginatePartners(rows);
    expect(page.data).toHaveLength(50);
    expect(page.nextCursor).toBe('p-49');
    expect(() => paginatePartners(rows, 0)).toThrow(/invalid page size/);
    expect(() => paginatePartners(rows, 101)).toThrow(/invalid page size/);
  });
});

describe('F-90 platform vs tenant boundary', () => {
  it('treats the program as platform-owned: no org/tenant scoping on partners', () => {
    const exported = exportPartnerData(partner(), [], []);
    expect(JSON.stringify(exported.partner)).not.toContain('orgId');
    expect(JSON.stringify(exported.partner)).not.toContain('tenantId');
  });

  it('never lets a partner summary surface credentials', () => {
    const summary = partnerVisibleSummary(PARTNER_A, CAMPAIGN, { campaigns: [campaign()], clicks: [], conversions: [], commissions: [], holds: [] });
    expect(JSON.stringify(summary)).not.toMatch(/token|secret|accessToken/i);
  });
});
