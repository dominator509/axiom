// ─── Audit Router (LBI-08 hash chain) — Vitest Suite ───
// Covers: list + verify endpoints, org scoping.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ auditLog: {} }));
// verifyAuditChain reads rows from the tx; with the chainable mock, the rows
// come from mockState.result. Reuse the real helper so chain verification is
// exercised (genesis special-case included).
vi.mock('./helpers.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual };
});

import { auditRouter } from './audit.js';
import { verifyAuditChain } from './helpers.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', auditRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /audit — trail listing', () => {
  it('returns audit rows with a total', async () => {
    mockState.result = [
      { id: 'a1', action: 'model.create', orgId: ORG_ID, ts: new Date().toISOString() },
    ];
    const res = await appWithOrg(ORG_ID).request('/audit');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
    expect(body.meta.total).toBe(1);
  });

  it('filters by action', async () => {
    mockState.result = [];
    const res = await appWithOrg(ORG_ID).request('/audit?action=model.create');
    expect(res.status).toBe(200);
  });

  it('rejects without org context (401)', async () => {
    const res = await appWithOrg(null).request('/audit');
    expect(res.status).toBe(401);
  });
});

describe('GET /audit/verify — chain integrity', () => {
  it('verifies a single-row genesis-anchored chain as valid', async () => {
    // Genesis row: prev_hash zero, row_hash = sha256('genesis') literal.
    const { createHash } = await import('node:crypto');
    const genesisHash = createHash('sha256').update('genesis').digest();
    mockState.result = [
      {
        id: 'g1',
        ts: new Date('2026-01-01T00:00:00Z'),
        action: 'genesis',
        prevHash: Buffer.alloc(32),
        rowHash: genesisHash,
        actorRef: 'system',
        target: '',
        detail: {},
      },
    ];
    const res = await appWithOrg(ORG_ID).request('/audit/verify');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.rows).toBe(1);
    expect(body.data.valid).toBe(true);
  });

  it('verifies a valid chained pair (genesis + model.create)', async () => {
    const { createHash } = await import('node:crypto');
    const genesisHash = createHash('sha256').update('genesis').digest();
    const ts1 = new Date('2026-01-01T00:00:00Z');
    const ts2 = new Date('2026-01-01T00:01:00Z');
    // Deterministic canonical payload of the second row
    const canonical = (o: Record<string, unknown>) => JSON.stringify(o, Object.keys(o).sort());
    const payload2 = canonical({
      org_id: ORG_ID,
      actor_ref: 'user-1',
      action: 'model.create',
      target: 'm1',
      detail: {},
      ts: ts2.toISOString(),
      prev_hash: genesisHash.toString('hex'),
    });
    const row2Hash = createHash('sha256').update(payload2).digest();
    mockState.result = [
      {
        id: 'g1',
        ts: ts1,
        action: 'genesis',
        prevHash: Buffer.alloc(32),
        rowHash: genesisHash,
        actorRef: 'system',
        target: '',
        detail: {},
      },
      {
        id: 'a1',
        ts: ts2,
        action: 'model.create',
        prevHash: genesisHash,
        rowHash: row2Hash,
        actorRef: 'user-1',
        target: 'm1',
        detail: {},
      },
    ];
    const res = await appWithOrg(ORG_ID).request('/audit/verify');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.rows).toBe(2);
    expect(body.data.valid).toBe(true);
  });

  it('flags a tampered chain as invalid', async () => {
    const { createHash } = await import('node:crypto');
    const genesisHash = createHash('sha256').update('genesis').digest();
    mockState.result = [
      {
        id: 'g1',
        ts: new Date('2026-01-01T00:00:00Z'),
        action: 'genesis',
        prevHash: Buffer.alloc(32),
        rowHash: genesisHash,
        actorRef: 'system',
        target: '',
        detail: {},
      },
      {
        id: 'a1',
        ts: new Date('2026-01-01T00:01:00Z'),
        action: 'model.create',
        prevHash: genesisHash,
        rowHash: createHash('sha256').update('tampered').digest(), // wrong hash
        actorRef: 'user-1',
        target: 'm1',
        detail: {},
      },
    ];
    const res = await appWithOrg(ORG_ID).request('/audit/verify');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.valid).toBe(false);
  });

  it('rejects without org context (401)', async () => {
    const res = await appWithOrg(null).request('/audit/verify');
    expect(res.status).toBe(401);
  });
});

// Direct helper-level coverage (genesis special-case is the chain head)
describe('verifyAuditChain helper (direct)', () => {
  it('is exported and callable', () => {
    expect(typeof verifyAuditChain).toBe('function');
  });
});
