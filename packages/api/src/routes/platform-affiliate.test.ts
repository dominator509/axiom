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

import { platformAffiliateRouter } from './platform-affiliate.js';

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

  it('reconciles one SaaS conversion into one commission event and is idempotent by billing key', async () => {
    const occurredAt = '2026-01-01T00:00:00.000Z';
    harness.state.results = [
      [{ id: campaignId, programId, partnerId, status: 'active', commissionBps: 2000 }],
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

  it('exports an approved payout file only and never represents a transfer', async () => {
    harness.state.results = [
      [{ id: partnerId, displayName: 'Partner', email: 'partner@example.com', status: 'active', termsVersion: 'v1' }],
      [{ id: 'commission-1', conversionId, partnerId, campaignId, kind: 'approved', amountCents: 2000, createdAt: new Date('2026-01-01T00:00:00.000Z') }],
      [],
    ];
    const response = await app().request(`/payouts/export?partnerId=${partnerId}&format=json`);
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { batch: { totalCents: number }; csv: string; transfer: string } };
    expect(body.data.batch.totalCents).toBe(2000);
    expect(body.data.csv).toContain('commission-1');
    expect(body.data.transfer).toBe('none');
  });
});
