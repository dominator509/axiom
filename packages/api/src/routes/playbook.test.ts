// ─── Playbook adherence Router (real DB-backed) — Vitest Suite ───
// Covers: deriveAdherenceInputs from real cadence + persistence of scores.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () =>
  mockDbFactory({ postTarget: {}, contentBundle: {}, postMetric: {}, playbookScore: {} }),
);
vi.mock('@axiom/llm-gateway', () => ({
  calculateCourseAdherence: vi.fn((input: any) => ({
    overall: 0.72,
    components: input,
    weights: {
      personaConsistency: 0.25,
      platformRuleCompliance: 0.25,
      exemplarSimilarity: 0.25,
      taskAlignment: 0.25,
    },
    passed: true,
    minimumThreshold: 0.5,
  })),
}));

import { playbookRouter } from './playbook.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', playbookRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /models/:modelId/playbook-score', () => {
  it('returns a neutral score when there is no activity (no 500 on empty)', async () => {
    mockState.result = [];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/playbook-score`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.score.overall).toBe(0.72);
    expect(body.data.postCount30d).toBe(0);
    expect(body.data.scheduleCount30d).toBe(0);
  });

  it('computes cadence inputs from published targets', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    mockState.result = [
      { platform: 'instagram', scheduledFor: yesterday, state: 'published' },
      { platform: 'instagram', scheduledFor: yesterday, state: 'published' },
    ];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/playbook-score`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.postCount30d).toBe(2);
    expect(body.data.scheduleCount30d).toBe(2);
  });

  it('rejects without org context (401)', async () => {
    const res = await appWithOrg(null).request(`/models/${MODEL_ID}/playbook-score`);
    expect(res.status).toBe(401);
  });
});

describe('POST /models/:modelId/playbook-score/record', () => {
  it('persists a score snapshot', async () => {
    mockState.result = [{ id: 'pb-1', orgId: ORG_ID, modelId: MODEL_ID, score: 72 }];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/playbook-score/record`, {
      method: 'POST',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.score).toBe(72);
  });

  it('rejects recording a score for a model outside the organization', async () => {
    mockState.result = [];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/playbook-score/record`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });

  it('rejects without org context (401)', async () => {
    const res = await appWithOrg(null).request(`/models/${MODEL_ID}/playbook-score/record`, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });
});
