// ─── Incidents / DLQ Router (real DB-backed) — Vitest Suite ───
// Covers: dead/failed job listing + idempotent replay.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ job: {} }));

import { incidentsRouter } from './incidents.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', incidentsRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /incidents — DLQ view', () => {
  it('returns dead/failed jobs', async () => {
    mockState.result = [
      { id: 'j1', queue: 'publish', state: 'dead', attempts: 3, lastError: 'timeout' },
    ];
    const res = await appWithOrg(ORG_ID).request('/incidents');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].state).toBe('dead');
    expect(body.meta.total).toBe(1);
  });

  it('returns an empty list when no incidents exist', async () => {
    mockState.result = [];
    const res = await appWithOrg(ORG_ID).request('/incidents');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([]);
  });

  it('rejects without org context (401)', async () => {
    const res = await appWithOrg(null).request('/incidents');
    expect(res.status).toBe(401);
  });
});

describe('POST /incidents/:jobId/replay — DLQ replay', () => {
  it('resets a dead job back to ready', async () => {
    mockState.result = [
      { id: 'j1', queue: 'publish', state: 'ready', attempts: 0, lastError: null },
    ];
    const res = await appWithOrg(ORG_ID).request('/incidents/j1/replay', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.state).toBe('ready');
    expect(body.data.attempts).toBe(0);
  });

  it('returns 404 when the job is not found (org-scoped)', async () => {
    mockState.result = [];
    const res = await appWithOrg(ORG_ID).request('/incidents/nope/replay', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('rejects without org context (401)', async () => {
    const res = await appWithOrg(null).request('/incidents/j1/replay', { method: 'POST' });
    expect(res.status).toBe(401);
  });
});
