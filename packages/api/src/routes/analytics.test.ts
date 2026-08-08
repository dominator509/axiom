// ─── Analytics Router (real DB-backed) — Vitest Suite ───
// Covers: post_metric aggregates per platform + daily series + totals.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ postMetric: {}, postTarget: {}, contentBundle: {} }));

import { analyticsRouter } from './analytics.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', analyticsRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /models/:modelId/analytics — aggregates', () => {
  it('returns zeroed totals when no metrics exist', async () => {
    mockState.result = [];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/analytics`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.totals.views).toBe(0);
    expect(body.data.totals.likes).toBe(0);
    expect(body.data.windowDays).toBe(30);
    expect(body.data.postsWithMetrics).toBe(0);
  });

  it('aggregates per-platform totals', async () => {
    mockState.result = [
      {
        platform: 'instagram',
        views: 100,
        likes: 10,
        shares: 2,
        comments: 3,
        engagementRate: 0.08,
      },
      { platform: 'x', views: 50, likes: 5, shares: 1, comments: 1, engagementRate: 0.06 },
    ];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/analytics?days=7`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.totals.views).toBe(150);
    expect(body.data.totals.likes).toBe(15);
    expect(body.data.perPlatform).toHaveLength(2);
  });

  it('clamps days to the 1..365 window', async () => {
    mockState.result = [];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/analytics?days=9999`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.windowDays).toBe(365);
  });

  it('rejects without org context (401)', async () => {
    const res = await appWithOrg(null).request(`/models/${MODEL_ID}/analytics`);
    expect(res.status).toBe(401);
  });
});
