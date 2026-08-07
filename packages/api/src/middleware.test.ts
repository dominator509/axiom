// ─── Contract middleware (L3.0) — Vitest Suite (M-3) ───
// Verifies the durable idempotency middleware (replay without re-execution,
// required-header 400), per-token rate limiting (429 + Retry-After), and
// correlation_id echo. The idempotency middleware persists to api_idempotency
// via @axiom/db, which is mocked with the shared chainable proxy.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { mockState, mockDbFactory } from './routes/test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ apiIdempotency: {} }));

import { idempotency, rateLimit, correlationId } from './contract.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';

function makeApp(opts: { rate?: { capacity?: number; refillPerSec?: number } } = {}) {
  const app = new Hono<{ Variables: { orgId: string; userId: string; correlationId?: string } }>();
  app.use('*', correlationId);
  app.use('*', async (c, next) => {
    // Production sets orgId via requireAuth before idempotency runs.
    c.set('orgId', ORG_ID);
    await next();
  });
  if (opts.rate) app.use('*', rateLimit(opts.rate));
  return app;
}

/** A route that records every execution (to prove replay skips it). */
function countedRoute(app: Hono<{ Variables: { orgId: string; userId: string; correlationId?: string } }>) {
  let calls = 0;
  app.post('/mutate', idempotency(), async (c) => {
    calls += 1;
    return c.json({ data: { ok: true, call: calls } }, 201);
  });
  return () => calls;
}

beforeEach(() => {
  mockState.result = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('idempotency middleware (durable, M-2)', () => {
  it('requires the Idempotency-Key header on mutations (400 problem+json)', async () => {
    const app = makeApp();
    let calls = 0;
    app.post('/mutate', idempotency(), async (c) => {
      calls += 1;
      return c.json({ data: { ok: true } }, 201);
    });
    const res = await app.request('/mutate', { method: 'POST' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.type).toBe('about:blank');
    expect(body.title).toBe('Bad Request');
    expect(body.detail).toContain('Idempotency-Key');
    expect(calls).toBe(0); // rejected before the handler ran
  });

  it('executes once, then replays the stored response without re-execution', async () => {
    const app = makeApp();
    const getCalls = countedRoute(app);
    const headers = { 'Idempotency-Key': 'key-1' };

    // First call: no prior row (mock returns []), handler executes, response persisted.
    mockState.result = [];
    const first = await app.request('/mutate', { method: 'POST', headers });
    expect(first.status).toBe(201);
    expect(getCalls()).toBe(1);

    // Second call: mock returns the persisted row → replay, handler NOT re-run.
    mockState.result = [
      {
        id: 'row-1',
        orgId: ORG_ID,
        method: 'POST',
        route: '/mutate',
        idemKey: 'key-1',
        status: 201,
        responseBody: { data: { ok: true, call: 1 } },
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    ];
    const second = await app.request('/mutate', { method: 'POST', headers });
    expect(second.status).toBe(201);
    const body = (await second.json()) as any;
    expect(body.data.call).toBe(1); // the ORIGINAL response, not a re-execution
    expect(getCalls()).toBe(1); // handler still ran exactly once
  });

  it('passes through non-mutating requests without requiring a key', async () => {
    const app = makeApp();
    app.get('/read', idempotency(), (c) => c.json({ data: [] }));
    const res = await app.request('/read');
    expect(res.status).toBe(200);
  });

  it('falls through to execute once when the DB is unavailable (no replay, no 500)', async () => {
    const app = makeApp();
    const getCalls = countedRoute(app);
    // db.transaction throws → middleware catch falls through to execute.
    vi.stubGlobal('db', undefined); // not used directly; simulate via mockState throw below
    // The mock db.transaction rejects:
    const { db } = await import('@axiom/db');
    (db.transaction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db down'));
    const res = await app.request('/mutate', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'key-x' },
    });
    expect(res.status).toBe(201);
    expect(getCalls()).toBe(1);
  });
});

describe('rateLimit middleware (L3.0)', () => {
  it('allows requests within the bucket', async () => {
    const app = makeApp({ rate: { capacity: 2, refillPerSec: 0 } });
    app.get('/x', (c) => c.json({ ok: true }));
    const hdrs = { 'X-API-Key': 'bucket-a' };
    const r1 = await app.request('/x', { headers: hdrs });
    const r2 = await app.request('/x', { headers: hdrs });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });

  it('returns 429 with Retry-After once the bucket is exhausted', async () => {
    const app = makeApp({ rate: { capacity: 1, refillPerSec: 0 } });
    app.get('/x', (c) => c.json({ ok: true }));
    const hdrs = { 'X-API-Key': 'bucket-b' }; // distinct token → fresh bucket
    const r1 = await app.request('/x', { headers: hdrs });
    const r2 = await app.request('/x', { headers: hdrs });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(429);
    expect(r2.headers.get('Retry-After')).toBeTruthy();
    const body = (await r2.json()) as any;
    expect(body.type).toBe('about:blank');
    expect(body.title).toBe('Too Many Requests');
    expect(body.detail).toBe('Rate limit exceeded');
  });
});

describe('correlationId middleware', () => {
  it('echoes an incoming X-Correlation-ID', async () => {
    const app = makeApp();
    app.get('/x', (c) => c.json({ ok: true }));
    const res = await app.request('/x', { headers: { 'X-Correlation-ID': 'corr-abc' } });
    expect(res.headers.get('X-Correlation-ID')).toBe('corr-abc');
  });

  it('generates a correlation id when none is supplied', async () => {
    const app = makeApp();
    app.get('/x', (c) => c.json({ ok: true }));
    const res = await app.request('/x');
    expect(res.headers.get('X-Correlation-ID')).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });
});

// keep the Context import referenced for future type-based tests
export type _Ctx = Context;
