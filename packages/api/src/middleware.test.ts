// ─── Contract middleware (L3.0) — Vitest Suite (M-3) ───
// Verifies the durable idempotency middleware (replay without re-execution,
// required-header 400), per-token rate limiting (429 + Retry-After), and
// correlation_id echo. The idempotency middleware persists to api_idempotency
// via @axiom/db, which is mocked with the shared chainable proxy.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { mockState, mockDbFactory } from './routes/test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ apiIdempotency: {} }));

import {
  idempotency,
  IDEMPOTENCY_KEY_MAX_BYTES,
  rateLimit,
  signInAttemptThrottle,
  correlationId,
} from './contract.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';

type MiddlewareTestApp = Hono<{
  Bindings: { incoming?: { socket?: { remoteAddress?: string } } };
  Variables: { orgId: string; userId: string; correlationId?: string };
}>;

function makeApp(
  opts: { rate?: { capacity?: number; refillPerSec?: number; maxBuckets?: number } } = {},
) {
  const app = new Hono<{
    Bindings: { incoming?: { socket?: { remoteAddress?: string } } };
    Variables: { orgId: string; userId: string; correlationId?: string };
  }>();
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
function countedRoute(app: MiddlewareTestApp) {
  let calls = 0;
  app.post('/mutate', idempotency(), async (c) => {
    calls += 1;
    return c.json({ data: { ok: true, call: calls } }, 201);
  });
  return () => calls;
}

beforeEach(() => {
  mockState.result = [];
  mockState.results = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('idempotency middleware (durable, M-2)', () => {
  function requestHash(body = '', contentType = '', query = ''): string {
    return createHash('sha256')
      .update('POST')
      .update('\n')
      .update('/mutate')
      .update('\n')
      .update(query)
      .update('\n')
      .update(contentType)
      .update('\n')
      .update(body)
      .digest('hex');
  }

  it('requires the Idempotency-Key header on mutations (400 problem+json)', async () => {
    const app = makeApp();
    let calls = 0;
    app.post('/mutate', idempotency(), async (c) => {
      calls += 1;
      return c.json({ data: { ok: true } }, 201);
    });
    const res = await app.request('/mutate', { method: 'POST' });
    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toMatch(/^application\/problem\+json/);
    const body = (await res.json()) as any;
    expect(body.type).toBe('about:blank');
    expect(body.title).toBe('Bad Request');
    expect(body.detail).toContain('Idempotency-Key');
    expect(calls).toBe(0); // rejected before the handler ran
  });

  it('rejects an oversized Idempotency-Key before hashing or reserving it', async () => {
    const app = makeApp();
    let calls = 0;
    app.post('/mutate', idempotency(), async (c) => {
      calls += 1;
      return c.json({ data: { ok: true } }, 201);
    });

    const res = await app.request('/mutate', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'x'.repeat(IDEMPOTENCY_KEY_MAX_BYTES + 1) },
    });

    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toMatch(/^application\/problem\+json/);
    expect(((await res.json()) as { detail: string }).detail).toContain('Idempotency-Key');
    expect(calls).toBe(0);
  });

  it('bounds declared mutation bodies before hashing or handler execution', async () => {
    const app = makeApp();
    let calls = 0;
    app.post('/mutate', idempotency(), async (c) => {
      calls += 1;
      await c.req.json();
      return c.json({ data: { ok: true } }, 201);
    });

    const res = await app.request('/mutate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(256 * 1024 + 1),
        'Idempotency-Key': 'oversized-declared',
      },
      body: '{}',
    });

    expect(res.status).toBe(413);
    expect(res.headers.get('Content-Type')).toMatch(/^application\/problem\+json/);
    expect(calls).toBe(0);
  });

  it('bounds chunked mutation bodies before hashing or handler execution', async () => {
    const app = makeApp();
    let calls = 0;
    app.post('/mutate', idempotency(), async (c) => {
      calls += 1;
      await c.req.json();
      return c.json({ data: { ok: true } }, 201);
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(256 * 1024 + 1));
        controller.close();
      },
    });
    const request = new Request('http://localhost/mutate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'oversized-chunked',
      },
      body: stream,
      duplex: 'half',
    } as RequestInit);

    const res = await app.fetch(request);
    expect(res.status).toBe(413);
    expect(calls).toBe(0);
  });

  it('replays the bounded body to downstream Hono parsers', async () => {
    const app = makeApp();
    app.use('*', async (c, next) => {
      await next();
      c.header('X-After-Idempotency', 'present');
    });
    const body = '{"value":"ok"}';
    let parsed: unknown;
    app.post('/mutate', idempotency(), async (c) => {
      parsed = await c.req.json();
      return c.json({ data: { ok: true } }, 201);
    });
    mockState.results = [
      [],
      [
        {
          id: 'row-body-cache',
          state: 'pending',
          request_hash: requestHash(body, 'application/json'),
          owner_token: 'owner-body-cache',
          status: null,
          response_body: null,
          expires_at: new Date(Date.now() + 86_400_000),
        },
      ],
      [],
      [{ id: 'row-body-cache' }],
    ];

    const res = await app.request('/mutate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'body-cache',
      },
      body,
    });

    expect(res.status).toBe(201);
    expect(parsed).toEqual({ value: 'ok' });
    expect(res.headers.get('X-After-Idempotency')).toBe('present');
    await expect(res.json()).resolves.toEqual({ data: { ok: true } });
  });

  it('executes once, then replays the stored response without re-execution', async () => {
    const app = makeApp();
    const getCalls = countedRoute(app);
    const headers = { 'Idempotency-Key': 'key-1' };

    // First call: reservation is claimed, handler executes, response is completed.
    mockState.results = [
      [],
      [
        {
          id: 'row-1',
          state: 'pending',
          request_hash: requestHash(),
          owner_token: 'owner-1',
          status: null,
          response_body: null,
          expires_at: new Date(Date.now() + 86_400_000),
        },
      ],
      [],
      [{ id: 'row-1' }],
    ];
    const first = await app.request('/mutate', { method: 'POST', headers });
    expect(first.status).toBe(201);
    expect(getCalls()).toBe(1);

    // Second call: claim conflicts and the completed row is replayed.
    mockState.results = [
      [],
      [],
      [
        {
          id: 'row-1',
          state: 'completed',
          request_hash: requestHash(),
          owner_token: null,
          status: 201,
          response_body: { data: { ok: true, call: 1 } },
          expires_at: new Date(Date.now() + 86_400_000),
        },
      ],
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

  it('fails closed before execution when the DB is unavailable', async () => {
    const app = makeApp();
    const getCalls = countedRoute(app);
    // The mock db.transaction rejects before a reservation can be established.
    const { db } = await import('@axiom/db');
    (db.transaction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db down'));
    const res = await app.request('/mutate', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'key-x' },
    });
    expect(res.status).toBe(503);
    expect(getCalls()).toBe(0);
  });

  it('rejects a concurrent duplicate while the first request is pending', async () => {
    const app = makeApp();
    const getCalls = countedRoute(app);
    mockState.results = [
      [],
      [],
      [
        {
          id: 'row-pending',
          state: 'pending',
          request_hash: requestHash(),
          owner_token: 'another-owner',
          status: null,
          response_body: null,
          expires_at: new Date(Date.now() + 86_400_000),
        },
      ],
    ];
    const res = await app.request('/mutate', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'key-pending' },
    });
    expect(res.status).toBe(409);
    expect(res.headers.get('Retry-After')).toBe('2');
    expect(getCalls()).toBe(0);
  });

  it('stores the sanitized 500 when the protected handler throws', async () => {
    const app = makeApp();
    let calls = 0;
    app.post('/mutate', idempotency(), async () => {
      calls += 1;
      throw new Error('provider request failed');
    });

    const headers = { 'Idempotency-Key': 'key-uncaught' };
    const requestHashValue = requestHash();
    mockState.results = [
      [],
      [
        {
          id: 'row-uncaught',
          state: 'pending',
          request_hash: requestHashValue,
          owner_token: 'owner-uncaught',
          status: null,
          response_body: null,
          expires_at: new Date(Date.now() + 86_400_000),
        },
      ],
      [],
      [],
      [],
      [{ id: 'row-uncaught' }],
    ];

    const first = await app.request('/mutate', { method: 'POST', headers });
    expect(first.status).toBe(500);
    expect(first.headers.get('Content-Type')).toMatch(/^application\/problem\+json/);
    expect(calls).toBe(1);

    mockState.results = [
      [],
      [],
      [
        {
          id: 'row-uncaught',
          state: 'completed',
          request_hash: requestHashValue,
          owner_token: null,
          status: 500,
          response_body: {
            type: 'about:blank',
            title: 'Internal Server Error',
            status: 500,
            detail: 'An internal error occurred',
            correlation_id: 'corr-uncaught',
          },
          expires_at: new Date(Date.now() + 86_400_000),
        },
      ],
    ];

    const second = await app.request('/mutate', { method: 'POST', headers });
    expect(second.status).toBe(500);
    expect(second.headers.get('Content-Type')).toMatch(/^application\/problem\+json/);
    expect(second.headers.get('X-Correlation-ID')).toBe('corr-uncaught');
    expect(calls).toBe(1);
  });

  it('rejects reuse of a key with a different request body', async () => {
    const app = makeApp();
    const getCalls = countedRoute(app);
    mockState.results = [
      [],
      [],
      [
        {
          id: 'row-existing',
          state: 'completed',
          request_hash: requestHash('different'),
          owner_token: null,
          status: 201,
          response_body: { data: { ok: true } },
          expires_at: new Date(Date.now() + 86_400_000),
        },
      ],
    ];
    const res = await app.request('/mutate', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'key-mismatch' },
    });
    expect(res.status).toBe(409);
    expect(getCalls()).toBe(0);
  });

  it('rejects reuse of a key with a different query string', async () => {
    const app = makeApp();
    const getCalls = countedRoute(app);
    mockState.results = [
      [],
      [],
      [
        {
          id: 'row-query-mismatch',
          state: 'completed',
          request_hash: requestHash('', '', '?modelId=model-a'),
          owner_token: null,
          status: 201,
          response_body: { data: { ok: true } },
          expires_at: new Date(Date.now() + 86_400_000),
        },
      ],
    ];
    const res = await app.request('/mutate?modelId=model-b', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'key-query-mismatch' },
    });
    expect(res.status).toBe(409);
    expect(getCalls()).toBe(0);
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
    expect(r2.headers.get('Content-Type')).toMatch(/^application\/problem\+json/);
    const body = (await r2.json()) as any;
    expect(body.type).toBe('about:blank');
    expect(body.title).toBe('Too Many Requests');
    expect(body.detail).toBe('Rate limit exceeded');
  });

  it('bounds attacker-controlled bucket cardinality with LRU eviction', async () => {
    const app = makeApp({ rate: { capacity: 1, refillPerSec: 0, maxBuckets: 2 } });
    app.get('/x', (c) => c.json({ ok: true }));
    await app.request('/x', { headers: { Authorization: 'Bearer cardinality-a' } });
    await app.request('/x', { headers: { Authorization: 'Bearer cardinality-b' } });
    await app.request('/x', { headers: { Authorization: 'Bearer cardinality-c' } });
    // The oldest bucket was evicted, so it is fresh rather than permanently
    // growing the process-wide map with every attacker-supplied credential.
    const replayOldest = await app.request('/x', {
      headers: { Authorization: 'Bearer cardinality-a' },
    });
    expect(replayOldest.status).toBe(200);
  });

  it('does not trust a spoofed forwarding header from a direct peer', async () => {
    const app = makeApp({ rate: { capacity: 1, refillPerSec: 0 } });
    app.get('/x', (c) => c.json({ ok: true }));
    const directPeer = { incoming: { socket: { remoteAddress: '203.0.113.10' } } };

    const first = await app.request(
      '/x',
      { headers: { 'X-Forwarded-For': 'spoofed-client-a' } },
      directPeer,
    );
    const second = await app.request(
      '/x',
      { headers: { 'X-Forwarded-For': 'spoofed-client-b' } },
      directPeer,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });

  it('uses the forwarded client address only behind a trusted proxy peer', async () => {
    const app = makeApp({ rate: { capacity: 1, refillPerSec: 0 } });
    app.get('/x', (c) => c.json({ ok: true }));
    const trustedProxy = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };

    const clientA = await app.request(
      '/x',
      { headers: { 'X-Forwarded-For': '198.51.100.10' } },
      trustedProxy,
    );
    const clientB = await app.request(
      '/x',
      { headers: { 'X-Forwarded-For': '198.51.100.11' } },
      trustedProxy,
    );
    const clientAReplay = await app.request(
      '/x',
      { headers: { 'X-Forwarded-For': '198.51.100.10' } },
      trustedProxy,
    );

    expect(clientA.status).toBe(200);
    expect(clientB.status).toBe(200);
    expect(clientAReplay.status).toBe(429);
  });
});

describe('rateLimit credential rotation + composition (adversarial)', () => {
  function composedApp() {
    const app = makeApp({ rate: { capacity: 100, refillPerSec: 0 } });
    // Route-level limiter composes with the global one (as the affiliate
    // claim router does on /api/affiliate).
    app.use('/strict/*', rateLimit({ capacity: 1, refillPerSec: 0 }));
    app.get('/strict/x', (c) => c.json({ ok: true }));
    app.get('/loose/x', (c) => c.json({ ok: true }));
    return app;
  }

  it('keys buckets per credential: rotating tokens bypass the exhausted bucket', async () => {
    const app = makeApp({ rate: { capacity: 1, refillPerSec: 0 } });
    app.get('/x', (c) => c.json({ ok: true }));
    const first = await app.request('/x', { headers: { Authorization: 'Bearer tok-one' } });
    const exhausted = await app.request('/x', { headers: { Authorization: 'Bearer tok-one' } });
    const rotated = await app.request('/x', { headers: { Authorization: 'Bearer tok-two' } });
    expect(first.status).toBe(200);
    expect(exhausted.status).toBe(429);
    // A rotated credential gets its own budget — the limiter is per-credential
    // by design, so this documents (not fixes) the rotation surface.
    expect(rotated.status).toBe(200);
  });

  it('enforces route-level and global limiters together', async () => {
    const app = composedApp();
    const s1 = await app.request('/strict/x');
    const s2 = await app.request('/strict/x');
    const loose = await app.request('/loose/x');
    expect(s1.status).toBe(200);
    expect(s2.status).toBe(429); // route-level limiter fired
    expect(loose.status).toBe(200); // global budget still has room
  });
});

describe('signInAttemptThrottle (adversarial)', () => {
  const VICTIM = 'victim@example.com';
  const OTHER = 'other@example.com';
  const GOOD = 'correct-horse';

  // The throttle keeps process-wide state, so each test gets a fresh module
  // instance for deterministic assertions about locks and eviction.
  let freshThrottle: typeof signInAttemptThrottle;

  function makeSignInApp(
    opts: { maxFailures?: number; lockSeconds?: number; maxRecords?: number } = {},
  ) {
    const app = new Hono<{
      Bindings: { incoming?: { socket?: { remoteAddress?: string } } };
      Variables: { orgId: string; userId: string; correlationId?: string };
    }>();
    app.use('*', correlationId);
    app.use('/api/auth/sign-in/email', freshThrottle(opts));
    app.post('/api/auth/sign-in/email', async (c) => {
      let body: { email?: unknown; password?: unknown } = {};
      try {
        body = (await c.req.json()) as typeof body;
      } catch {
        return c.json({ error: 'malformed' }, 400);
      }
      if (typeof body.email !== 'string') return c.json({ error: 'bad request' }, 400);
      if (body.password === GOOD) return c.json({ ok: true });
      return c.json({ error: 'invalid credentials' }, 401);
    });
    return app;
  }

  function wrong(email: string) {
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'wrong' }),
    } as const;
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.resetModules();
    ({ signInAttemptThrottle: freshThrottle } = await import('./contract.js'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('locks an account after maxFailures consecutive 401s, with 429 + Retry-After', async () => {
    const app = makeSignInApp({ maxFailures: 3, lockSeconds: 900 });
    for (let i = 0; i < 3; i += 1) {
      const r = await app.request('/api/auth/sign-in/email', wrong(VICTIM));
      expect(r.status).toBe(401);
    }
    const locked = await app.request('/api/auth/sign-in/email', wrong(VICTIM));
    expect(locked.status).toBe(429);
    expect(locked.headers.get('Retry-After')).toBe('900');
    const body = (await locked.json()) as any;
    expect(body.title).toBe('Too Many Requests');
    expect(body.retry_after_seconds).toBe(900);
  });

  it('does not extend the lock from attempts made while locked', async () => {
    const app = makeSignInApp({ maxFailures: 3, lockSeconds: 900 });
    for (let i = 0; i < 3; i += 1) await app.request('/api/auth/sign-in/email', wrong(VICTIM));
    // Probe the locked account — these must not renew or extend the lock.
    for (let i = 0; i < 5; i += 1) {
      const r = await app.request('/api/auth/sign-in/email', wrong(VICTIM));
      expect(r.status).toBe(429);
    }
    vi.advanceTimersByTime(901_000); // past the original lock, not a renewed one
    const after = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: VICTIM, password: GOOD }),
    });
    expect(after.status).toBe(200);
  });

  it('clears the failure record on successful sign-in', async () => {
    const app = makeSignInApp({ maxFailures: 3, lockSeconds: 900 });
    const good = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: VICTIM, password: GOOD }),
    } as const;
    await app.request('/api/auth/sign-in/email', wrong(VICTIM));
    await app.request('/api/auth/sign-in/email', wrong(VICTIM));
    expect((await app.request('/api/auth/sign-in/email', good)).status).toBe(200);
    // Two more failures after a success: the streak restarted, so no lock.
    await app.request('/api/auth/sign-in/email', wrong(VICTIM));
    const r = await app.request('/api/auth/sign-in/email', wrong(VICTIM));
    expect(r.status).toBe(401);
  });

  it('scopes the lock to the attacked account only', async () => {
    const app = makeSignInApp({ maxFailures: 3, lockSeconds: 900 });
    for (let i = 0; i < 3; i += 1) await app.request('/api/auth/sign-in/email', wrong(VICTIM));
    expect((await app.request('/api/auth/sign-in/email', wrong(VICTIM))).status).toBe(429);
    const other = await app.request('/api/auth/sign-in/email', wrong(OTHER));
    expect(other.status).toBe(401);
  });

  it('never counts 400s or bodies without an email', async () => {
    const app = makeSignInApp({ maxFailures: 3, lockSeconds: 900 });
    // Malformed body (400) and missing-email bodies must not feed the map.
    for (let i = 0; i < 10; i += 1) {
      const malformed = await app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'not-json',
      });
      expect(malformed.status).toBe(400);
      const noEmail = await app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'x' }),
      });
      expect(noEmail.status).toBe(400);
    }
    // Distinct wrong-password emails still get their own fresh budget: the
    // churn above must not have locked a shared 'unknown' bucket.
    const probe = await app.request('/api/auth/sign-in/email', wrong(OTHER));
    expect(probe.status).toBe(401);
  });

  it('bounds distinct-account churn with LRU eviction and keeps live records fresh', async () => {
    const app = makeSignInApp({ maxFailures: 3, lockSeconds: 3600, maxRecords: 2 });
    await app.request('/api/auth/sign-in/email', wrong('a@example.com')); // evicted later
    await app.request('/api/auth/sign-in/email', wrong('b@example.com'));
    await app.request('/api/auth/sign-in/email', wrong('c@example.com')); // evicts a@
    // a@ lost its single failure to eviction: two more failures must not lock.
    await app.request('/api/auth/sign-in/email', wrong('a@example.com'));
    const aAgain = await app.request('/api/auth/sign-in/email', wrong('a@example.com'));
    expect(aAgain.status).toBe(401);
    // b@ was evicted mid-test, so its budget restarted: failures 1, 2, then the
    // lock fires on the 3rd and bites on the 4th request.
    await app.request('/api/auth/sign-in/email', wrong('b@example.com'));
    const bThird = await app.request('/api/auth/sign-in/email', wrong('b@example.com'));
    expect(bThird.status).toBe(401);
    const bLocked = await app.request('/api/auth/sign-in/email', wrong('b@example.com'));
    expect(bLocked.status).toBe(401); // lock fires on the 3rd failure...
    const bBites = await app.request('/api/auth/sign-in/email', wrong('b@example.com'));
    expect(bBites.status).toBe(429); // ...and bites on the next request
  });

  it('prefers evicting unlocked records so active locks survive churn', async () => {
    const app = makeSignInApp({ maxFailures: 2, lockSeconds: 3600, maxRecords: 2 });
    // Lock victim, then churn a fresh account to force an eviction.
    await app.request('/api/auth/sign-in/email', wrong(VICTIM));
    await app.request('/api/auth/sign-in/email', wrong(VICTIM));
    expect((await app.request('/api/auth/sign-in/email', wrong(VICTIM))).status).toBe(429);
    await app.request('/api/auth/sign-in/email', wrong(OTHER));
    // The lock must survive: the unlocked OTHER record is evicted instead.
    expect((await app.request('/api/auth/sign-in/email', wrong(VICTIM))).status).toBe(429);
  });

  it('drops dead records so stale keys do not accumulate', async () => {
    const app = makeSignInApp({ maxFailures: 2, lockSeconds: 60 });
    await app.request('/api/auth/sign-in/email', wrong(VICTIM));
    await app.request('/api/auth/sign-in/email', wrong(VICTIM)); // locked
    vi.advanceTimersByTime(61_000); // lock expired
    // Failure streak restarts from zero after expiry (failures were reset
    // when the lock fired): a single new failure must not re-lock.
    const r = await app.request('/api/auth/sign-in/email', wrong(VICTIM));
    expect(r.status).toBe(401);
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
