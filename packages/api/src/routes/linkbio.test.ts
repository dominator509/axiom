// ─── Link-in-bio (F-48..F-53) — Vitest Suite ───
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ linkbioProvider: {}, linkbioClick: {} }));

import { linkbioRouter } from './linkbio.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const PROVIDER_ID = '33333333-3333-4333-8333-333333333333';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', linkbioRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /models/:modelId/linkbio', () => {
  it('returns providers + primary + native flag', async () => {
    mockState.result = [
      { id: PROVIDER_ID, orgId: ORG_ID, modelId: MODEL_ID, kind: 'native', enabled: true, isPrimary: true },
      { id: 'p2', orgId: ORG_ID, modelId: MODEL_ID, kind: 'linktree', enabled: false, isPrimary: false },
    ];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/linkbio`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.providers).toHaveLength(2);
    expect(body.data.nativeEnabled).toBe(true);
    expect(body.data.primary.kind).toBe('native');
  });

  it('returns empty provider list when none configured', async () => {
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/linkbio`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.providers).toEqual([]);
    expect(body.data.primary).toBeNull();
    expect(body.data.nativeEnabled).toBe(false);
  });
});

describe('POST /models/:modelId/linkbio', () => {
  it('enables a provider (201)', async () => {
    mockState.result = [{ id: PROVIDER_ID, orgId: ORG_ID, modelId: MODEL_ID, kind: 'native', enabled: true, isPrimary: false }];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/linkbio`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'native', config: { handle: '@luna' } }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.kind).toBe('native');
    expect(body.data.enabled).toBe(true);
  });

  it('rejects an unknown provider kind (400)', async () => {
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/linkbio`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'myspace' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /models/:modelId/linkbio/:kind', () => {
  it('disables a provider', async () => {
    mockState.result = [{ id: PROVIDER_ID, orgId: ORG_ID, modelId: MODEL_ID, kind: 'native', enabled: false, isPrimary: false }];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/linkbio/native`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.enabled).toBe(false);
  });

  it('returns 404 when the provider is not enabled', async () => {
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/linkbio/native`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('rejects an unknown kind (400)', async () => {
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/linkbio/myspace`, { method: 'DELETE' });
    expect(res.status).toBe(400);
  });
});

describe('GET /models/:modelId/linkbio/analytics', () => {
  it('returns normalized per-provider analytics', async () => {
    // Empty result — no providers, no clicks: totalClicks = 0.
    mockState.result = [];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/linkbio/analytics`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.providers).toBeDefined();
    expect(body.data.totalClicks).toBe(0);
  });
});

describe('POST /linkbio/clicks', () => {
  it('records a click (200)', async () => {
    const res = await appWithOrg(ORG_ID).request('/linkbio/clicks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: PROVIDER_ID, target: 'https://fanvue.com/luna', source: 'bio' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
  });

  it('rejects a bad providerId (400)', async () => {
    const res = await appWithOrg(ORG_ID).request('/linkbio/clicks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'not-a-uuid', target: 'x' }),
    });
    expect(res.status).toBe(400);
  });
});
