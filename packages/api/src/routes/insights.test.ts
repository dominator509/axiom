// ─── Analytics / Viral / Playbook / Audit / Incidents — Vitest Suites ───
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () =>
  mockDbFactory({
    postMetric: {},
    postTarget: {},
    contentBundle: {},
    viralExemplar: {},
    playbookScore: {},
    auditLog: {},
    job: {},
  }),
);

import { analyticsRouter } from './analytics.js';
import { viralRouter } from './viral.js';
import { playbookRouter } from './playbook.js';
import { auditRouter } from './audit.js';
import { incidentsRouter } from './incidents.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '44444444-4444-4444-8444-444444444444';

function withOrg(router: any) {
  return (orgId: string | null) => {
    const app = new Hono<AppBindings>();
    app.use('*', async (c, next) => {
      if (orgId) c.set('orgId', orgId);
      c.set('userId', 'user-1');
      await next();
    });
    app.route('/', router);
    return app;
  };
}

beforeEach(() => {
  mockState.result = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('analytics — GET /models/:id/analytics', () => {
  const appWithOrg = withOrg(analyticsRouter);
  it('returns totals + per-platform + daily series', async () => {
    mockState.result = [
      {
        platform: 'instagram',
        views: 1000,
        likes: 100,
        shares: 10,
        comments: 5,
        engagementRate: 4.2,
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/analytics?days=30`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.totals).toBeDefined();
    expect(body.data.perPlatform).toBeDefined();
    expect(body.data.daily).toBeDefined();
    expect(body.data.windowDays).toBe(30);
  });

  it('returns zeroed totals when no metrics exist', async () => {
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/analytics`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.totals).toEqual({ views: 0, likes: 0, shares: 0, comments: 0 });
  });

  it('rejects without org context (401)', async () => {
    const res = await appWithOrg(null).request(`/models/${MODEL_ID}/analytics`);
    expect(res.status).toBe(401);
  });
});

describe('viral — GET /models/:id/viral', () => {
  const appWithOrg = withOrg(viralRouter);
  it('returns exemplar distribution + top performers', async () => {
    mockState.result = [{ label: 'viral', count: 3 }];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/viral`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.byLabel).toBeDefined();
    expect(body.data.top).toBeDefined();
    expect(body.data.byPlatform).toBeDefined();
  });

  it('returns empty state when no exemplars', async () => {
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/viral`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.totalExemplars).toBe(0);
  });
});

describe('playbook — GET /models/:id/playbook-score', () => {
  const appWithOrg = withOrg(playbookRouter);
  it('computes a course adherence score from real cadence', async () => {
    mockState.result = [{ platform: 'instagram', scheduledFor: new Date(), state: 'published' }];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/playbook-score`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.score.overall).toBeGreaterThanOrEqual(0);
    expect(body.data.score.overall).toBeLessThanOrEqual(1);
    expect(body.data.history).toBeDefined();
  });

  it('records a score snapshot (201)', async () => {
    mockState.result = [{ id: 'score-1', orgId: ORG_ID, modelId: MODEL_ID, score: 70 }];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/playbook-score/record`, {
      method: 'POST',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.score).toBe(70);
  });
});

describe('audit — GET /audit + /audit/verify', () => {
  const appWithOrg = withOrg(auditRouter);
  it('returns recent audit entries', async () => {
    mockState.result = [{ id: 'a1', orgId: ORG_ID, action: 'model.create', actorRef: 'user-1' }];
    const res = await appWithOrg(ORG_ID).request('/audit');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
  });

  it('verifies the hash chain (valid with an empty chain)', async () => {
    const res = await appWithOrg(ORG_ID).request('/audit/verify');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.valid).toBe(true);
    expect(body.data.rows).toBe(0);
  });

  it('detects a broken chain when a row hash is tampered', async () => {
    // First chain head: prev = zeros, row = sha256(prev || canonical(row))
    const { createHash } = await import('node:crypto');
    const first = {
      org_id: ORG_ID,
      actor_ref: 'user-1',
      action: 'genesis',
      target: 'org',
      detail: {},
      ts: new Date().toISOString(),
      prev_hash: '0'.repeat(64),
    };
    const keys = Object.keys(first).sort();
    const payload = JSON.stringify(first, keys);
    const goodRow = createHash('sha256').update(payload).digest();
    const tampered = Buffer.from(goodRow);
    tampered[0] ^= 0xff;
    mockState.result = [
      {
        id: 'a1',
        ts: new Date(),
        action: 'genesis',
        prevHash: Buffer.alloc(32),
        rowHash: tampered,
        actorRef: 'user-1',
        target: 'org',
        detail: {},
      },
    ];
    const res = await appWithOrg(ORG_ID).request('/audit/verify');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.valid).toBe(false);
  });
});

describe('incidents — GET /incidents + replay', () => {
  const appWithOrg = withOrg(incidentsRouter);
  it('returns dead/failed jobs', async () => {
    mockState.result = [
      { id: JOB_ID, orgId: ORG_ID, kind: 'publish', state: 'dead', attempts: 3, maxAttempts: 3 },
    ];
    const res = await appWithOrg(ORG_ID).request('/incidents');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].state).toBe('dead');
  });

  it('replays a dead job back to ready (200)', async () => {
    mockState.result = [
      { id: JOB_ID, orgId: ORG_ID, kind: 'publish', state: 'ready', attempts: 0 },
    ];
    const res = await appWithOrg(ORG_ID).request(`/incidents/${JOB_ID}/replay`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.state).toBe('ready');
  });

  it('returns 404 when the job is not in the org', async () => {
    const res = await appWithOrg(ORG_ID).request(`/incidents/${JOB_ID}/replay`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
