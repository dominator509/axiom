// ─── Generation pipeline (F-36) — Vitest Suite ───
// POST /models/:id/generate — Master Prompt Engine variants + ToS text
// evaluation (LBI-11) + bundle persistence. LLM enrichment is best-effort.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ modelProfile: {}, contentBundle: {} }));
const mediaQueue = vi.hoisted(() => vi.fn(async () => ({ id: 'queued-job' })));
vi.mock('@axiom/worker', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), enqueueJob: mediaQueue,
}));

// Mock the LLM gateway so the enrich path is deterministic in tests.
vi.mock('@axiom/llm-gateway', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    LLMGateway: class {
      async chat(_messages: unknown, options: { userId?: string }) {
        capturedOptions = options;
        // Match the real subscription gateway's identity requirement.
        if (!options.userId) throw new Error('Authenticated user is required');
        return {
          content: 'Enriched caption ✨',
          model: 'test',
          provider: 'test',
          cost: 0,
          tokens: { prompt: 1, completion: 1, total: 2 },
          latency: 1,
          cached: false,
        };
      }
    },
    // Capture the assembled S0–S3 segments so tests can assert S2 carries
    // real viral exemplars (F-83).
    assemblePrompt: vi.fn((segments: Record<string, string>) => {
      capturedSegments = segments;
      return (actual.assemblePrompt as (s: Record<string, string>) => string)(segments);
    }),
  };
});

let capturedSegments: Record<string, string> | null = null;
let capturedOptions: { userId?: string } | null = null;

import { generateRouter } from './generate.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';

function appWithOrg(orgId: string | null, userId = 'user-1') {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', userId);
    await next();
  });
  app.route('/', generateRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
  mockState.results = [];
  mediaQueue.mockClear();
  capturedOptions = null;
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
  it('queues media under the authenticated identity and leaves visual ToS pending', async () => {
    mockState.result = [{ id: MODEL_ID, orgId: ORG_ID, displayName: 'Luna', handle: 'luna', state: 'generated' }];
    const res = await appWithOrg(ORG_ID, 'operator-1').request(`/models/${MODEL_ID}/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody, userId: 'attacker-selected-profile', media: { kind: 'image', prompt: 'A landscape' } }),
    });
    expect(res.status).toBe(201);
    expect(mediaQueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      kind: 'media.generate', queue: 'content',
      payload: { bundleId: MODEL_ID, userId: 'operator-1', kind: 'image', prompt: 'A landscape', aspectRatio: 'auto' },
    }));
    const body = await res.json() as any;
    expect(body.data.mediaGeneration).toBe('queued');
    expect(body.data.tosReport.verdict).toBe('pending');
  });
  it('refuses video whose source image is unavailable in the model scope', async () => {
    // withOrgContext executes set_config before the model and asset lookups.
    mockState.results = [[], [{ id: MODEL_ID, orgId: ORG_ID }], []];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody, media: { kind: 'video', prompt: 'Animate this', sourceAssetId: MODEL_ID } }),
    });
    expect(res.status).toBe(400);
    expect(mediaQueue).not.toHaveBeenCalled();
  });
  it('requires a source asset for video', async () => {
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody, media: { kind: 'video', prompt: 'Animate this' } }),
    });
    expect(res.status).toBe(400);
    expect(mediaQueue).not.toHaveBeenCalled();
  });
  it.each(['user-1', 'user-2'])('uses authenticated subscription identity for %s, not request-body identity', async (userId) => {
    mockState.result = [{
      id: MODEL_ID, orgId: ORG_ID, displayName: 'Luna Vex', handle: 'lunavex',
      bio: null, avatarUrl: null, state: 'generated',
    }];
    const res = await appWithOrg(ORG_ID, userId).request(`/models/${MODEL_ID}/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody, enrichWithLlm: true, userId: 'other-users-profile' }),
    });
    expect(res.status).toBe(201);
    expect(capturedOptions).toMatchObject({ userId });
  });
  it('generates 5 variants + a bundle with a passing ToS report (201)', async () => {
    // The chainable mock returns the same row for the model lookup AND the
    // bundle insert — include state on the shared row so both resolve.
    mockState.result = [
      {
        id: MODEL_ID,
        orgId: ORG_ID,
        displayName: 'Luna Vex',
        handle: 'lunavex',
        bio: null,
        avatarUrl: null,
        state: 'generated',
      },
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
      {
        id: MODEL_ID,
        orgId: ORG_ID,
        displayName: 'Luna Vex',
        handle: 'lunavex',
        bio: null,
        avatarUrl: null,
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody, platforms: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an unsupported platform before touching the model (400)', async () => {
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody, platforms: ['not-a-platform'] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate platform targets before creating a bundle (400)', async () => {
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody, platforms: ['instagram', 'instagram'] }),
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

  it('injects real viral exemplars into the S2 segment (F-83)', async () => {
    // Seed the model row + a top-performing exemplar (viral label + features).
    mockState.result = [
      {
        id: MODEL_ID,
        orgId: ORG_ID,
        displayName: 'Luna Vex',
        handle: 'lunavex',
        bio: null,
        avatarUrl: null,
        state: 'generated',
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        platform: 'instagram',
        label: 'viral',
        perfScore: 2.4,
        features: {
          title: 'Golden hour beach reel',
          caption: 'Sunset swims hit different',
          hashtags: ['beach', 'goldenhour'],
          aiNotes: 'high save rate',
        },
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody, enrichWithLlm: true }),
    });
    expect(res.status).toBe(201);
    expect(capturedSegments).not.toBeNull();
    expect(capturedSegments!.S2).toContain('[VIRAL EXEMPLARS]');
    expect(capturedSegments!.S2).toContain('Golden hour beach reel');
    expect(capturedSegments!.S2).toContain('Sunset swims hit different');
    expect(capturedSegments!.S2).toContain('high save rate');
  });
});
