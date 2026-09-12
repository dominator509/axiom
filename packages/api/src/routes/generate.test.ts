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
        capturedMessages = _messages;
        // Match the real subscription gateway's identity requirement.
        if (!options.userId) throw new Error('Authenticated user is required');
        return {
          content: revisionReply ?? 'Enriched caption ✨',
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
let capturedMessages: unknown = null;
let revisionReply: string | null = null;

import { generateRouter } from './generate.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const BUNDLE_ID = '33333333-3333-4333-8333-333333333333';

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
  capturedMessages = null;
  revisionReply = null;
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
  it('snapshots the profile character lock into the initial media job', async () => {
    mockState.result = [{ id: MODEL_ID, orgId: ORG_ID, displayName: 'Luna', handle: 'luna', state: 'generated',
      characterLockPrompt: 'Copper hair, green jacket', characterLockVersion: 7 }];
    const res = await appWithOrg(ORG_ID, 'operator-1').request(`/models/${MODEL_ID}/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody, media: { kind: 'image', prompt: 'Walking beside the sea' } }),
    });
    expect(res.status).toBe(201);
    expect(mediaQueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      payload: expect.objectContaining({ prompt: 'Walking beside the sea',
        characterLockPrompt: 'Copper hair, green jacket', characterLockVersion: 7 }),
    }));
  });
  it('rejects an initial scene that overflows the provider limit when combined with the saved identity', async () => {
    mockState.result = [{ id: MODEL_ID, orgId: ORG_ID, displayName: 'Luna', handle: 'luna', state: 'generated',
      characterLockPrompt: 'x'.repeat(2000), characterLockVersion: 7 }];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody, media: { kind: 'image', prompt: 'y'.repeat(2100) } }),
    });
    expect(res.status).toBe(422);
    expect(mediaQueue).not.toHaveBeenCalled();
  });
  it('queues media under the authenticated identity and leaves visual ToS pending', async () => {
    mockState.result = [{ id: MODEL_ID, orgId: ORG_ID, displayName: 'Luna', handle: 'luna', state: 'generated' }];
    const res = await appWithOrg(ORG_ID, 'operator-1').request(`/models/${MODEL_ID}/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody, userId: 'attacker-selected-profile', media: { kind: 'image', prompt: 'A landscape' } }),
    });
    expect(res.status).toBe(201);
    expect(mediaQueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      kind: 'media.generate', queue: 'content',
      payload: { bundleId: MODEL_ID, userId: 'operator-1', kind: 'image', provider: 'grok', prompt: 'A landscape', aspectRatio: 'auto', characterLockPrompt: '', characterLockVersion: 0 },
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

describe('Grok prompt revision', () => {
  const bundle = { id: BUNDLE_ID, state: 'hold', assetId: 'asset-1', tosReport: { verdict: 'block' } };
  const job = { id: 'job-1', state: 'done', lockedBy: null, lockedAt: null,
    payload: { userId: 'user-1', kind: 'video', prompt: 'The last tried scene, not the initial scene' } };
  const attempt = { state: 'completed', assetId: 'asset-1' };
  const request = (body: object = { acknowledgeUsage: true }) => appWithOrg(ORG_ID).request(
    `/models/${MODEL_ID}/generate/${BUNDLE_ID}/suggest-prompt`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  it.each(['image', 'video'])('asks only the owning Grok account about the saved last %s prompt', async kind => {
    mockState.results = [[], [bundle], [{ ...job, payload: { ...job.payload, kind } }], [attempt]];
    revisionReply = JSON.stringify({ prompt: 'A minimally revised scene', explanation: 'Changed one detail.' });
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { lastTriedPrompt: job.payload.prompt,
      prompt: 'A minimally revised scene', provider: 'grok', requiresReview: true, mediaQueued: false } });
    expect(capturedOptions).toMatchObject({ provider: 'grok', userId: 'user-1', signal: expect.any(AbortSignal) });
    expect(JSON.parse((capturedMessages as { content: string }[])[2].content)).toMatchObject({
      mediaKind: kind, lastTriedPrompt: job.payload.prompt, scanVerdict: 'block',
    });
    expect(mediaQueue).not.toHaveBeenCalled();
  });
  it.each([
    { ...job, state: 'running' }, { ...job, lockedAt: new Date() },
    { ...job, payload: { ...job.payload, userId: 'another-user' } },
    { ...job, payload: { ...job.payload, provider: 'unsupported-provider' } },
  ])('refuses active or differently owned source jobs before contacting Grok', async unsafe => {
    mockState.results = [[], [bundle], [unsafe]];
    expect((await request()).status).toBe(409);
    expect(capturedOptions).toBeNull();
  });
  it('refuses unresolved provider attempts', async () => {
    mockState.results = [[], [bundle], [job], [{ ...attempt, state: 'unknown' }]];
    expect((await request()).status).toBe(409);
    expect(capturedOptions).toBeNull();
  });
  it.each(['not JSON', '{}', JSON.stringify({ prompt: job.payload.prompt, explanation: 'No change' }),
    JSON.stringify({ prompt: 'x'.repeat(4001), explanation: 'Too large' })])('rejects unusable provider output without queuing', async reply => {
    mockState.results = [[], [bundle], [job], [attempt]];
    revisionReply = reply;
    expect((await request()).status).toBe(502);
    expect(mediaQueue).not.toHaveBeenCalled();
  });
  it('rejects missing usage consent and client-supplied prompt history', async () => {
    expect((await request({})).status).toBe(400);
    expect((await request({ acknowledgeUsage: true, prompt: 'Spoofed history' })).status).toBe(400);
    expect(capturedOptions).toBeNull();
  });
});

describe('explicit media retry', () => {
  const previous = { id: BUNDLE_ID, orgId: ORG_ID, modelId: MODEL_ID, state: 'hold', assetId: null,
    captions: { instagram: 'Studio' }, hashtags: [], tosReport: { verdict: 'pending' } };
  const job = { id: 'job-1', state: 'dead', lockedBy: null, lockedAt: null, lastError: null,
    payload: { userId: 'user-1', kind: 'image', prompt: 'A landscape', aspectRatio: '1:1' } };
  const request = (body: object = { acknowledgeUsage: true }) => appWithOrg(ORG_ID).request(
    `/models/${MODEL_ID}/generate/${BUNDLE_ID}/retry`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  it('queues a fresh scan-bound bundle only for confirmed pre-dispatch failure', async () => {
    mockState.results = [[], [previous], [job], [], [{ id: MODEL_ID }]];
    expect((await request()).status).toBe(201);
    expect(mediaQueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      payload: { kind: 'image', provider: 'grok', prompt: 'A landscape', aspectRatio: '1:1', userId: 'user-1', bundleId: MODEL_ID, characterLockPrompt: '', characterLockVersion: 0 },
      dedupeParts: ['media.generate', MODEL_ID],
    }));
    expect(mockState.updates).toContainEqual(expect.objectContaining({ state: 'rejected' }));
  });
  it.each(['dispatched', 'failed', 'unknown'])('refuses a retained %s attempt', async state => {
    mockState.results = [[], [previous], [job], [{ state }]];
    expect((await request()).status).toBe(409);
    expect(mediaQueue).not.toHaveBeenCalled();
  });
  it.each([
    { ...job, state: 'running' }, { ...job, lockedBy: 'worker' },
    { ...job, lastError: 'external-side-effect-unknown: failure' },
    { ...job, payload: { ...job.payload, userId: 'another-user' } },
  ])('rejects active, uncertain, or another operator requests', async unsafe => {
    mockState.results = [[], [previous], [unsafe], []];
    expect((await request()).status).toBe(409);
    expect(mediaQueue).not.toHaveBeenCalled();
  });
  it('requires edits for blocked media and never reuses its asset', async () => {
    const blocked = { ...previous, assetId: 'asset-1', tosReport: { verdict: 'block' } };
    mockState.results = [[], [blocked], [{ ...job, state: 'done' }], [{ state: 'completed', assetId: 'asset-1' }]];
    expect((await request()).status).toBe(409);
    mockState.results = [[], [blocked], [{ ...job, state: 'done' }], [{ state: 'completed', assetId: 'asset-1' }], [{ id: MODEL_ID }]];
    expect((await request({ acknowledgeUsage: true, prompt: 'A ceramic vase in a studio' })).status).toBe(201);
    expect(mediaQueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      payload: expect.objectContaining({ prompt: 'A ceramic vase in a studio' }),
    }));
  });
  it('rejects already superseded bundles', async () => {
    mockState.results = [[], [{ ...previous, state: 'rejected' }]];
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'MEDIA_RETRY_NOT_QUEUED' });
    expect(mediaQueue).not.toHaveBeenCalled();
  });
  it('requires explicit usage acknowledgement', async () => {
    expect((await request({})).status).toBe(400);
    expect(mediaQueue).not.toHaveBeenCalled();
  });
  it('never silently retries an unsupported provider through Grok', async () => {
    mockState.results = [[], [previous], [{ ...job, payload: { ...job.payload, provider: 'unsupported-provider' } }]];
    expect((await request()).status).toBe(409);
    expect(mediaQueue).not.toHaveBeenCalled();
  });
  it('preserves the last attempt character lock when the scene is revised', async () => {
    mockState.results = [[], [previous], [{ ...job, payload: { ...job.payload,
      characterLockPrompt: 'Identity from revision seven', characterLockVersion: 7, sanitizeMetadata: true } }], [], [{ id: MODEL_ID }]];
    expect((await request({ acknowledgeUsage: true, prompt: 'A different scene' })).status).toBe(201);
    expect(mediaQueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      payload: expect.objectContaining({ prompt: 'A different scene', characterLockPrompt: 'Identity from revision seven', characterLockVersion: 7, sanitizeMetadata: true }),
    }));
  });
  it('rejects attempts to replace the saved character lock through retry JSON', async () => {
    expect((await request({ acknowledgeUsage: true, prompt: 'A scene', characterLockPrompt: 'Different identity' })).status).toBe(400);
    expect(mediaQueue).not.toHaveBeenCalled();
  });
});
