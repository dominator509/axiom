import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';

const programId = '11111111-1111-4111-8111-111111111111';
const partnerId = '22222222-2222-4222-8222-222222222222';
const campaignId = '33333333-3333-4333-8333-333333333333';
const conversionId = '44444444-4444-4444-8444-444444444444';

const harness = vi.hoisted(() => {
  const state: { result: unknown; results: unknown[]; updates: unknown[]; inserts: unknown[] } = {
    result: [], results: [], updates: [], inserts: [],
  };
  const chain = (): any => new Proxy(function () {}, {
    get(_target, property: string | symbol) {
      if (property === 'then') {
        return (resolve: (value: unknown) => void, reject?: (error: unknown) => void) => {
          Promise.resolve(state.results.length > 0 ? state.results.shift() : state.result).then(resolve, reject);
        };
      }
      if (property === 'values' || property === 'set') {
        return (value: unknown) => {
          if (property === 'values') state.inserts.push(value);
          else state.updates.push(value);
          return chain();
        };
      }
      return () => chain();
    },
  });
  const db = {
    select: vi.fn(() => chain()),
    insert: vi.fn(() => chain()),
    update: vi.fn(() => chain()),
    transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(chain())),
  };
  const schema = new Proxy({}, { get: () => ({}) });
  return { db, schema, state };
});

vi.mock('@axiom/db', () => harness);

import { affiliateClaimRouter, platformAffiliateRouter, publicPlatformAffiliateRouter } from './platform-affiliate.js';

function app() {
  const server = new Hono<AppBindings>();
  server.use('*', async (c, next) => {
    c.set('userId', 'owner-user');
    c.set('orgId', '55555555-5555-4555-8555-555555555555');
    c.set('role', 'owner');
    await next();
  });
  server.route('/', platformAffiliateRouter);
  return server;
}

function publicApp() {
  const server = new Hono<AppBindings>();
  server.route('/', publicPlatformAffiliateRouter);
  return server;
}

function claimApp(userId = 'creator-user') {
  const server = new Hono<AppBindings>();
  server.use('*', async (c, next) => {
    c.set('userId', userId);
    c.set('orgId', '');
    c.set('role', null);
    await next();
  });
  server.route('/', affiliateClaimRouter);
  return server;
}

function jsonRequest(path: string, body: unknown, method = 'POST') {
  return app().request(path, {
    method,
    headers: { 'content-type': 'application/json', 'Idempotency-Key': 'test-key' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  harness.state.result = [];
  harness.state.results = [];
  harness.state.updates = [];
  harness.state.inserts = [];
  vi.clearAllMocks();
});

describe('platform affiliate API', () => {
  it('returns platform program state and aggregate summary without an org scope', async () => {
    harness.state.results = [
      [{ id: programId, slug: 'fanthynks', name: 'FanThynks creator referral program', status: 'active', defaultCommissionBps: 2000 }],
      [{ id: partnerId, programId, displayName: 'Partner', email: 'partner@example.com', status: 'active' }],
      [{ id: campaignId, programId, partnerId, status: 'active' }],
      [{ kind: 'click' }, { kind: 'visit' }],
      [{ id: conversionId }],
      [{ conversionId, kind: 'approved', amountCents: 2000 }],
      [],
    ];
    const response = await app().request('/program');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        program: { slug: 'fanthynks' },
        holds: [],
        summary: {
          partners: 1,
          campaigns: 1,
          attributionEvents: 2,
          conversions: 1,
          accruedCents: 2000,
          openHolds: 0,
        },
      },
    });
  });

  it('does not activate a partner without disclosure acceptance', async () => {
    const response = await jsonRequest('/partners', {
      displayName: 'Partner',
      email: 'partner@example.com',
      termsVersion: 'v1',
      status: 'active',
      disclosureAccepted: false,
    });
    expect(response.status).toBe(422);
    expect(harness.db.transaction).not.toHaveBeenCalled();
  });

  it('creates a partner and records the platform audit event', async () => {
    harness.state.results = [
      [{ id: programId, slug: 'fanthynks' }],
      [{ id: partnerId, programId, displayName: 'Partner', email: 'partner@example.com', status: 'active' }],
      [],
    ];
    const response = await jsonRequest('/partners', {
      displayName: 'Partner',
      email: 'PARTNER@example.com',
      termsVersion: 'v1',
      status: 'active',
      disclosureAccepted: true,
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ data: { id: partnerId, status: 'active' } });
    expect(harness.state.inserts[0]).toMatchObject({
      programId,
      email: 'partner@example.com',
      disclosureAcceptedAt: expect.any(Date),
    });
    expect(harness.state.inserts).toHaveLength(2);
  });

  it('exports only the partner-owned projection and preserves revoke semantics', async () => {
    harness.state.results = [
      [{ id: partnerId, programId, displayName: 'Partner', email: 'partner@example.com', status: 'active', termsVersion: 'v1', disclosureAcceptedAt: new Date('2026-01-01T00:00:00.000Z') }],
      [{ id: campaignId, partnerId, name: 'Launch', slug: 'launch', status: 'active', commissionBps: 2000, createdAt: new Date('2026-01-02T00:00:00.000Z') }],
      [{ id: 'commission-1', conversionId, partnerId, campaignId, kind: 'approved', amountCents: 2000, createdAt: new Date('2026-01-03T00:00:00.000Z') }],
    ];
    const response = await app().request(`/partners/${partnerId}/export`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        partner: { partnerId, email: 'partner@example.com', status: 'active' },
        campaigns: [{ campaignId, partnerId, slug: 'launch' }],
        commissions: [{ commissionId: 'commission-1', partnerId, amountCents: 2000 }],
      },
      deletion: { mode: 'revoke', preservesAuditAttribution: true },
    });
  });

  it('reconciles one SaaS conversion into one commission event and is idempotent by billing key', async () => {
    const occurredAt = '2026-01-01T00:00:00.000Z';
    harness.state.results = [
      [{ id: campaignId, programId, partnerId, status: 'active', commissionBps: 2000 }],
      [{ id: programId, status: 'active' }],
      [{ id: partnerId, programId, status: 'active', disclosureAcceptedAt: new Date('2026-01-01T00:00:00.000Z') }],
      [{ id: 'identity-event-1' }],
      [],
      [{ id: conversionId, campaignId, partnerId, kind: 'subscription_started', amountCents: 10000 }],
      [{ id: 'commission-1', conversionId, kind: 'accrued', amountCents: 2000 }],
      [],
    ];
    const response = await jsonRequest('/conversions/reconcile', {
      campaignId,
      kind: 'subscription_started',
      amountCents: 10000,
      billingEventKey: 'billing-event-1',
      creatorUserId: 'creator-user',
      occurredAt,
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      data: { id: conversionId },
      commission: { amountCents: 2000, kind: 'accrued' },
      duplicate: false,
    });
    expect(harness.state.inserts[1]).toMatchObject({
      conversionId,
      amountCents: 2000,
      kind: 'accrued',
    });
  });

  it('refuses a conversion that has no prior referral identity stitch', async () => {
    harness.state.results = [
      [{ id: campaignId, programId, partnerId, status: 'active', commissionBps: 2000 }],
      [{ id: programId, status: 'active' }],
      [{ id: partnerId, programId, status: 'active', disclosureAcceptedAt: new Date('2026-01-01T00:00:00.000Z') }],
      [],
    ];
    const response = await jsonRequest('/conversions/reconcile', {
      campaignId,
      kind: 'subscription_started',
      amountCents: 10000,
      billingEventKey: 'billing-event-without-stitch',
      creatorUserId: 'creator-user',
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ detail: 'conversion requires an earlier referral identity stitch' });
    expect(harness.state.inserts).toHaveLength(0);
  });

  it('refuses a refund that has no source billing event key', async () => {
    harness.state.results = [
      [{ id: campaignId, programId, partnerId, status: 'active', commissionBps: 2000 }],
      [{ id: programId, status: 'active' }],
      [{ id: partnerId, programId, status: 'active', disclosureAcceptedAt: new Date('2026-01-01T00:00:00.000Z') }],
      [{ id: 'identity-event-1' }],
    ];
    const response = await jsonRequest('/conversions/reconcile', {
      campaignId,
      kind: 'subscription_refunded',
      amountCents: 10000,
      billingEventKey: 'refund-without-source',
      creatorUserId: 'creator-user',
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ detail: 'refund requires a source billing event key' });
    expect(harness.state.inserts).toHaveLength(0);
  });

  it('exports an approved payout file only and never represents a transfer', async () => {
    harness.state.result = [{ id: 'export-1' }];
    harness.state.results = [
      [{ id: partnerId, programId, displayName: 'Partner', email: 'partner@example.com', status: 'active', termsVersion: 'v1' }],
      [{ id: 'commission-1', conversionId, partnerId, campaignId, kind: 'approved', amountCents: 2000, createdAt: new Date('2026-01-01T00:00:00.000Z') }],
      [],
    ];
    const response = await app().request(`/payouts/export?partnerId=${partnerId}&format=json`);
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { batch: { totalCents: number }; csv: string; transfer: string; exportId: string } };
    expect(body.data.batch.totalCents).toBe(2000);
    expect(body.data.csv).toContain('commission-1');
    expect(body.data.transfer).toBe('none');
    expect(body.data.exportId).toBe('export-1');
    expect(harness.state.inserts).toContainEqual(expect.objectContaining({
      programId,
      partnerId,
      commissionIds: ['commission-1'],
      totalCents: 2000,
      exportFormat: 'csv',
    }));
  });
});

describe('public affiliate referral links', () => {
  it('records an anonymous click and redirects to same-origin login with the opaque token', async () => {
    harness.state.results = [
      [{ id: campaignId, programId, partnerId, referralToken: 'ref-token', status: 'active' }],
      [{ id: programId, status: 'active' }],
      [{ id: partnerId, programId, status: 'active', disclosureAcceptedAt: new Date('2026-01-01T00:00:00.000Z') }],
    ];
    const response = await publicApp().request('/r/ref-token', { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('http://localhost/login?affiliate_ref=ref-token');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(harness.state.inserts).toHaveLength(1);
    expect(harness.state.inserts[0]).toMatchObject({
      programId,
      campaignId,
      partnerId,
      kind: 'click',
      metadata: { source: 'public_referral_redirect' },
    });
    expect(String((harness.state.inserts[0] as { eventKey: string }).eventKey)).toMatch(/^public-click:/);
  });

  it('does not record or redirect an inactive campaign', async () => {
    harness.state.results = [[{ id: campaignId, programId, partnerId, referralToken: 'ref-token', status: 'paused' }]];
    const response = await publicApp().request('/r/ref-token', { redirect: 'manual' });
    expect(response.status).toBe(404);
    expect(harness.state.inserts).toHaveLength(0);
  });
});

describe('authenticated affiliate referral claims', () => {
  it('stitches the signed-in creator identity exactly once after referral login', async () => {
    harness.state.results = [
      [{ id: campaignId, programId, partnerId, referralToken: 'ref-token', status: 'active' }],
      [{ id: programId, status: 'active' }],
      [{ id: partnerId, programId, status: 'active', disclosureAcceptedAt: new Date('2026-01-01T00:00:00.000Z') }],
      [{ id: 'identity-event-1', campaignId, partnerId, programId, kind: 'identity_stitch', creatorUserId: 'creator-user' }],
    ];
    const response = await claimApp().request('/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ referralToken: 'ref-token' }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: { claimed: true }, duplicate: false });
    expect(harness.state.inserts[0]).toMatchObject({
      programId, campaignId, partnerId, kind: 'identity_stitch',
      creatorUserId: 'creator-user', metadata: { source: 'signup_referral_claim' },
      eventKey: `identity-stitch:${campaignId}:creator-user`,
    });
  });

  it('returns a duplicate receipt without creating a second identity stitch', async () => {
    harness.state.results = [
      [{ id: campaignId, programId, partnerId, referralToken: 'ref-token', status: 'active' }],
      [{ id: programId, status: 'active' }],
      [{ id: partnerId, programId, status: 'active', disclosureAcceptedAt: new Date('2026-01-01T00:00:00.000Z') }],
      [],
      [{ id: 'identity-event-1', campaignId, partnerId, programId, kind: 'identity_stitch', creatorUserId: 'creator-user' }],
    ];
    const response = await claimApp().request('/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ referralToken: 'ref-token' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { claimed: true }, duplicate: true });
    expect(harness.state.inserts).toHaveLength(1);
  });
});
