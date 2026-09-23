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
  mockState.results = [];
  mockState.updates = [];
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
    const priorRunAfter = new Date(Date.now() + 60 * 60 * 1000);
    mockState.results = [[], [{ id: 'j1', state: 'dead', lastError: null }]];
    mockState.result = [
      {
        id: 'j1',
        queue: 'publish',
        state: 'ready',
        attempts: 0,
        lastError: null,
        runAfter: priorRunAfter,
        lockedBy: 'old-worker',
        lockedAt: priorRunAfter,
      },
    ];
    const res = await appWithOrg(ORG_ID).request('/incidents/j1/replay', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.state).toBe('ready');
    expect(body.data.attempts).toBe(0);
    expect(mockState.updates).toContainEqual(
      expect.objectContaining({
        state: 'ready',
        attempts: 0,
        lastError: null,
        lockedBy: null,
        lockedAt: null,
        startedAt: null,
        completedAt: null,
      }),
    );
  });

  it('returns 404 when the job is not found (org-scoped)', async () => {
    mockState.result = [];
    const res = await appWithOrg(ORG_ID).request('/incidents/nope/replay', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it.each(['ready', 'running', 'done'])('refuses to reset a %s job', async (state) => {
    mockState.result = [{ id: 'j-active', state, lastError: null }];
    const res = await appWithOrg(ORG_ID).request('/incidents/j-active/replay', {
      method: 'POST',
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ detail: 'Only dead or failed jobs can be replayed' });
    expect(mockState.updates).toHaveLength(0);
  });

  it('rejects without org context (401)', async () => {
    const res = await appWithOrg(null).request('/incidents/j1/replay', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('blocks replay when a provider side effect has an unknown outcome', async () => {
    mockState.result = [
      {
        id: 'j-unknown',
        orgId: ORG_ID,
        kind: 'publish.target',
        state: 'dead',
        lastError: 'external-side-effect-unknown: provider response lost',
      },
    ];
    const res = await appWithOrg(ORG_ID).request('/incidents/j-unknown/replay', {
      method: 'POST',
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      detail: expect.stringContaining('reconcile the external side effect'),
    });
    expect(mockState.updates).toHaveLength(0);
  });
});

describe('POST /incidents/:jobId/discard — DLQ discard', () => {
  it('marks a safe dead job cancelled and appends an audit event', async () => {
    mockState.results = [[], [{ id: 'j1', state: 'dead', lastError: 'worker timeout' }]];
    mockState.result = [{ id: 'j1', state: 'cancelled', lastError: 'worker timeout' }];
    const res = await appWithOrg(ORG_ID).request('/incidents/j1/discard', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { id: 'j1', state: 'cancelled' } });
    expect(mockState.updates).toContainEqual(expect.objectContaining({
      state: 'cancelled', lockedBy: null, lockedAt: null, completedAt: expect.any(Date),
    }));
    expect(mockState.insertValues.flat().some((row: any) => row.action === 'incident.discard')).toBe(true);
  });

  it.each(['ready', 'running', 'done', 'cancelled'])('refuses to discard a %s job', async state => {
    mockState.results = [[], [{ id: 'j-active', state, lastError: null }]];
    const res = await appWithOrg(ORG_ID).request('/incidents/j-active/discard', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ detail: 'Only dead or failed jobs can be discarded' });
    expect(mockState.updates).toHaveLength(0);
  });

  it('blocks discard when a provider side effect has an unknown outcome', async () => {
    mockState.results = [[], [{
      id: 'j-unknown', state: 'dead', lastError: 'external-side-effect-unknown: provider response lost',
    }]];
    const res = await appWithOrg(ORG_ID).request('/incidents/j-unknown/discard', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ detail: expect.stringContaining('reconcile the external side effect') });
    expect(mockState.updates).toHaveLength(0);
  });

  it('rejects without organization context and hides jobs from other organizations', async () => {
    expect((await appWithOrg(null).request('/incidents/j1/discard', { method: 'POST' })).status).toBe(401);
    mockState.results = [[], []];
    expect((await appWithOrg(ORG_ID).request('/incidents/other/discard', { method: 'POST' })).status).toBe(404);
    expect(mockState.updates).toHaveLength(0);
  });
});
