// ─── Bundles Router (real DB-backed) — Vitest Suite ───
// Covers: org-scoped list/get/create + approve/revise/reject lifecycle with
// ToS gating (LBI-11) and audit writes, using the chainable @axiom/db mock.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ contentBundle: {}, postTarget: {} }));
vi.mock('@axiom/worker', () => ({
  enqueueJob: vi.fn(async () => ({ id: 'job-1' })),
  asPlatform: vi.fn((platform: string) => {
    const supported = [
      'instagram',
      'tiktok',
      'x',
      'youtube',
      'reddit',
      'threads',
      'discord',
      'telegram',
      'facebook',
      'snapchat',
      'fanvue',
    ];
    if (!supported.includes(platform)) throw new Error(`unsupported target platform '${platform}'`);
    return platform;
  }),
}));

import { bundlesRouter } from './bundles.js';
import { enqueueJob } from '@axiom/worker';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const BUNDLE_ID = '33333333-3333-4333-8333-333333333333';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', bundlesRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
  mockState.results = [];
  vi.mocked(enqueueJob).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET / — list bundles', () => {
  it('returns rows for the org (optionally filtered by modelId/state)', async () => {
    mockState.result = [{ id: BUNDLE_ID, orgId: ORG_ID, modelId: MODEL_ID, state: 'generated' }];
    const res = await appWithOrg(ORG_ID).request(`/?modelId=${MODEL_ID}&state=generated`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].state).toBe('generated');
  });

  it('returns an empty list when no bundles exist', async () => {
    const res = await appWithOrg(ORG_ID).request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([]);
  });

  it('rejects without org context (401)', async () => {
    const res = await appWithOrg(null).request('/');
    expect(res.status).toBe(401);
  });
});

describe('GET /:id — get bundle', () => {
  it('returns the bundle when in the org', async () => {
    mockState.result = [{ id: BUNDLE_ID, orgId: ORG_ID, modelId: MODEL_ID, state: 'generated' }];
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.id).toBe(BUNDLE_ID);
  });

  it('returns 404 when the bundle is not in the org', async () => {
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}`);
    expect(res.status).toBe(404);
  });
});

describe('POST / — create bundle', () => {
  it('creates a bundle in generated state with captions and audits', async () => {
    mockState.result = [{ id: BUNDLE_ID, orgId: ORG_ID, modelId: MODEL_ID, state: 'generated' }];
    const res = await appWithOrg(ORG_ID).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        modelId: MODEL_ID,
        captions: { instagram: 'hello' },
        hashtags: ['model'],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.state).toBe('generated');
    expect(body.data.orgId).toBe(ORG_ID);
  });

  it('rejects a non-uuid modelId', async () => {
    const res = await appWithOrg(ORG_ID).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: 'not-a-uuid' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a missing modelId', async () => {
    const res = await appWithOrg(ORG_ID).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /:id/approve — ToS-gated approval (LBI-11)', () => {
  it('approves a passing bundle and creates post targets', async () => {
    const generatedBundle = {
      id: BUNDLE_ID,
      orgId: ORG_ID,
      modelId: MODEL_ID,
      state: 'generated',
      tosReport: { verdict: 'pass', scores: [] },
    };
    const approvedBundle = { ...generatedBundle, state: 'approved' };
    mockState.result = [approvedBundle];
    mockState.results = [
      [],
      [generatedBundle],
      [{ id: BUNDLE_ID }],
      [{ id: BUNDLE_ID }],
      [approvedBundle],
    ];
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platforms: ['instagram', 'x'] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.state).toBe('approved');
    expect(enqueueJob).toHaveBeenCalledTimes(2);
    expect(enqueueJob).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        queue: 'publish',
        kind: 'publish.target',
        runAfter: expect.any(Date),
        dedupeParts: ['publish.target', BUNDLE_ID],
      }),
    );
  });

  it('rejects approval when the ToS verdict is block (409)', async () => {
    mockState.result = [
      {
        id: BUNDLE_ID,
        orgId: ORG_ID,
        modelId: MODEL_ID,
        state: 'generated',
        tosReport: { verdict: 'block', scores: [] },
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platforms: ['instagram'] }),
    });
    expect(res.status).toBe(409);
  });

  it('rejects approval of a bundle that is no longer generated (409)', async () => {
    mockState.result = [
      {
        id: BUNDLE_ID,
        orgId: ORG_ID,
        modelId: MODEL_ID,
        state: 'approved',
        tosReport: { verdict: 'pass', scores: [] },
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platforms: ['instagram'] }),
    });
    expect(res.status).toBe(409);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('rejects an unsupported target platform before creating a job (400)', async () => {
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platforms: ['onlyfans'] }),
    });
    expect(res.status).toBe(400);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('rejects a bundle with an empty platforms array (400)', async () => {
    mockState.result = [
      { id: BUNDLE_ID, orgId: ORG_ID, state: 'generated', tosReport: { verdict: 'pass' } },
    ];
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platforms: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the bundle is not in the org', async () => {
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platforms: ['instagram'] }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /:id/revise — return to generated', () => {
  it('revises a bundle with instructions', async () => {
    mockState.result = [{ id: BUNDLE_ID, orgId: ORG_ID, modelId: MODEL_ID, state: 'generated' }];
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/revise`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instructions: 'make it warmer' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.state).toBe('generated');
  });

  it('rejects missing instructions (400)', async () => {
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/revise`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects revising an approved bundle (409)', async () => {
    mockState.results = [[], [{ id: BUNDLE_ID, state: 'approved' }]];
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/revise`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instructions: 'make it warmer' }),
    });
    expect(res.status).toBe(409);
  });
});

describe('POST /:id/reject', () => {
  it('rejects a bundle', async () => {
    mockState.results = [
      [],
      [{ id: BUNDLE_ID, state: 'generated' }],
      [{ id: BUNDLE_ID, orgId: ORG_ID, modelId: MODEL_ID, state: 'rejected' }],
    ];
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/reject`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.state).toBe('rejected');
  });

  it('rejects an approved bundle without leaving its publish work eligible (409)', async () => {
    mockState.results = [[], [{ id: BUNDLE_ID, state: 'approved' }]];
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/reject`, { method: 'POST' });
    expect(res.status).toBe(409);
  });

  it('returns 404 when the bundle is not in the org', async () => {
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/reject`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
