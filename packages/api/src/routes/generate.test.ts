// ─── Generation pipeline (F-36) — Vitest Suite ───
// POST /models/:id/generate — Master Prompt Engine variants + ToS text
// evaluation (LBI-11) + bundle persistence. LLM enrichment is best-effort.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ modelProfile: {}, contentBundle: {} }));

// Mock the LLM gateway so the enrich path is deterministic in tests.
vi.mock('@axiom/llm-gateway', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    LLMGateway: class {
      async chat() {
        return { content: 'Enriched caption ✨', model: 'test', provider: 'test', cost: 0, tokens: { prompt: 1, completion: 1, total: 2 }, latency: 1, cached: false };
      }
    },
  };
});

import { generateRouter } from './generate.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', generateRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const validBody = {
  style: 'beach',
  outfit: 'summer dress',
  location: 'Miami Beach',
  mood: 'energetic',
  lighting: 'golden hour',
  aspectRatio: '4:5',
  platforms: ['instagram'],
};

describe('POST /models/:id/generate', () => {
  it('generates 5 variants + a bundle with a passing ToS report (201)', async () => {
    // The chainable mock returns the same row for the model lookup AND the
    // bundle insert — include state on the shared row so both resolve.
    mockState.result = [
      { id: MODEL_ID, orgId: ORG_ID, displayName: 'Luna Vex', handle: 'lunavex', bio: null, avatarUrl: null, state: 'generated' },
    ];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.variants).toHaveLength(5);
    expect(body.data.bundle.state).toBe('generated');
    expect(body.data.tosReport.verdict).toBe('pass');
  });

  it('returns 404 when the model is not in the org', async () => {
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(404);
  });

  it('rejects an empty platforms array (400)', async () => {
    mockState.result = [
      { id: MODEL_ID, orgId: ORG_ID, displayName: 'Luna Vex', handle: 'lunavex', bio: null, avatarUrl: null },
    ];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody, platforms: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects without org context (401)', async () => {
    const res = await appWithOrg(null).request(`/models/${MODEL_ID}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(401);
  });
});
