// ─── Viral insights Router (real DB-backed) — Vitest Suite ───
// Covers: org-scoped exemplar aggregation by label/platform + top performers.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ viralExemplar: {} }));

import { viralRouter } from './viral.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', viralRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /models/:modelId/viral — insights', () => {
  it('returns empty aggregation when no exemplars exist (no 500 on empty)', async () => {
    mockState.result = [];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/viral`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.totalExemplars).toBe(0);
    expect(body.data.byLabel).toEqual([]);
    expect(body.data.byPlatform).toEqual([]);
    expect(body.data.top).toEqual([]);
  });

  it('aggregates exemplars by label and platform with totals', async () => {
    mockState.result = [
      { label: 'viral', count: 2 },
      { label: 'strong', count: 1 },
    ];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/viral`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.totalExemplars).toBe(3);
    expect(body.data.byLabel).toHaveLength(2);
  });

  it('clamps limit to 100', async () => {
    mockState.result = [[], [], []];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/viral?limit=9999`);
    expect(res.status).toBe(200);
  });

  it('rejects without org context (401)', async () => {
    const res = await appWithOrg(null).request(`/models/${MODEL_ID}/viral`);
    expect(res.status).toBe(401);
  });
});
