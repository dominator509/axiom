// ─── Weekly digests Router (F-28) — Vitest Suite ───
// POST /digests/generate → enqueue digest.weekly (deduped per ISO week)
// GET  /digests          → org's digest cards (cursor paginated)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ relayCard: {}, job: {} }));

import { digestsRouter, isoWeekKey } from './digests.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', digestsRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isoWeekKey', () => {
  it('returns the Monday of the current week (UTC)', () => {
    // 2026-08-07 is a Friday → week start 2026-08-03 (Monday)
    expect(isoWeekKey(new Date('2026-08-07T12:00:00Z'))).toBe('2026-08-03');
    // Monday itself is its own week start
    expect(isoWeekKey(new Date('2026-08-03T00:00:00Z'))).toBe('2026-08-03');
    // Sunday 2026-08-09 belongs to the same ISO week (Mon 08-03)
    expect(isoWeekKey(new Date('2026-08-09T23:59:00Z'))).toBe('2026-08-03');
  });
});

describe('POST /digests/generate', () => {
  it('requires org (401 without session)', async () => {
    const res = await appWithOrg(null).request('/digests/generate', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('enqueues a digest.weekly job and returns its id', async () => {
    mockState.result = [{ id: 'job-1' }];
    const res = await appWithOrg(ORG_ID).request('/digests/generate', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.jobId).toBe('job-1');
  });

  it('returns 409 when the week digest is already enqueued (dedupe hit)', async () => {
    mockState.result = []; // enqueueJob onConflictDoNothing → no rows
    const res = await appWithOrg(ORG_ID).request('/digests/generate', { method: 'POST' });
    expect(res.status).toBe(409);
  });
});

describe('GET /digests', () => {
  it('returns digest cards with cursor metadata', async () => {
    mockState.result = [
      { id: 'card-1', orgId: ORG_ID, channel: 'digest', title: 'Weekly digest — 2026-08-03', createdAt: new Date('2026-08-07T00:00:00Z') },
    ];
    const res = await appWithOrg(ORG_ID).request('/digests');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].channel).toBe('digest');
    expect(body.meta.next_cursor).toBeNull();
  });

  it('returns empty list with null cursor when no digests', async () => {
    const res = await appWithOrg(ORG_ID).request('/digests');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([]);
    expect(body.meta.next_cursor).toBeNull();
  });
});
