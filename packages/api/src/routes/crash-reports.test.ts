// ─── Crash sink Router (F-73) — Vitest Suite ───
// POST  /crash-reports        → capture; upsert by (org, fingerprint)
// GET   /crash-reports        → grouped issues (cursor paginated, status filter)
// PATCH /crash-reports/:id/resolve → mark resolved

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ crashReport: {} }));

import { crashReportsRouter, crashFingerprint } from './crash-reports.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', crashReportsRouter);
  return app;
}

const reportBody = {
  eventId: 'evt-1',
  service: 'api',
  release: '0.1.0',
  environment: 'production',
  message: 'TypeError: cannot read properties of undefined',
  stacktrace: [{ function: 'processJob', filename: 'worker.ts' }],
  correlationId: 'corr-1',
};

beforeEach(() => {
  mockState.result = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('crashFingerprint', () => {
  it('is stable for identical (service, message, first frame)', () => {
    const a = crashFingerprint('api', 'boom', [{ function: 'f1' }]);
    const b = crashFingerprint('api', 'boom', [{ function: 'f1' }]);
    expect(a).toBe(b);
  });

  it('differs when the first stack frame changes', () => {
    const a = crashFingerprint('api', 'boom', [{ function: 'f1' }]);
    const b = crashFingerprint('api', 'boom', [{ function: 'f2' }]);
    expect(a).not.toBe(b);
  });
});

describe('POST /crash-reports', () => {
  it('requires org (401 without session)', async () => {
    const res = await appWithOrg(null).request('/crash-reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(reportBody),
    });
    expect(res.status).toBe(401);
  });

  it('rejects an invalid body', async () => {
    const res = await appWithOrg(ORG_ID).request('/crash-reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ service: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('captures a new crash (count 1 → isNew true)', async () => {
    mockState.result = [{ id: 'crash-1', orgId: ORG_ID, fingerprint: 'abc', count: 1, status: 'open' }];
    const res = await appWithOrg(ORG_ID).request('/crash-reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(reportBody),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.isNew).toBe(true);
    expect(body.data.id).toBe('crash-1');
  });

  it('marks a recurring crash as existing (count > 1 → isNew false)', async () => {
    mockState.result = [{ id: 'crash-1', orgId: ORG_ID, fingerprint: 'abc', count: 3, status: 'open' }];
    const res = await appWithOrg(ORG_ID).request('/crash-reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(reportBody),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.isNew).toBe(false);
  });
});

describe('GET /crash-reports', () => {
  it('lists grouped issues with cursor metadata', async () => {
    mockState.result = [
      { id: 'crash-1', orgId: ORG_ID, fingerprint: 'abc', count: 5, lastSeen: new Date('2026-08-07T00:00:00Z') },
    ];
    const res = await appWithOrg(ORG_ID).request('/crash-reports');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].count).toBe(5);
    expect(body.meta.next_cursor).toBeNull();
  });

  it('returns empty list when no crashes', async () => {
    const res = await appWithOrg(ORG_ID).request('/crash-reports');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([]);
  });
});

describe('PATCH /crash-reports/:id/resolve', () => {
  it('resolves an open issue', async () => {
    mockState.result = [{ id: 'crash-1', orgId: ORG_ID, status: 'resolved' }];
    const res = await appWithOrg(ORG_ID).request('/crash-reports/crash-1/resolve', { method: 'PATCH' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.status).toBe('resolved');
  });

  it('404s when the issue is not found', async () => {
    const res = await appWithOrg(ORG_ID).request('/crash-reports/nope/resolve', { method: 'PATCH' });
    expect(res.status).toBe(404);
  });
});
