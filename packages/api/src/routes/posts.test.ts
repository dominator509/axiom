// ─── Posts / calendar (F-10) — Vitest Suite ───
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () => ({
  ...mockDbFactory({
    postTarget: {},
    contentBundle: {},
    asset: {},
    job: { id: {}, orgId: {}, kind: {}, state: {}, payload: {}, lastError: {} },
  }),
  getPublishingConsentStatus: vi.fn(async () => ({ ok: true, missing: [] })),
  consentRequirementMessage: vi.fn(
    (_status: unknown, platform: string) => `consent required for ${platform}`,
  ),
}));
vi.mock('@axiom/worker', () => ({
  EXTERNAL_SIDE_EFFECT_UNKNOWN_PREFIX: 'external-side-effect-unknown:',
  enqueueJob: vi.fn(async () => ({ id: 'job-1' })),
  resolveCapabilities: vi.fn((platform: string) => ({
    media: platform === 'x' || platform === 'reddit' ? ['text'] : ['image'],
  })),
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

import { postsRouter } from './posts.js';
import { enqueueJob } from '@axiom/worker';
import { getPublishingConsentStatus } from '@axiom/db';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const BUNDLE_ID = '33333333-3333-4333-8333-333333333333';
const POST_ID = '44444444-4444-4444-8444-444444444444';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', postsRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
  mockState.results = [];
  vi.mocked(enqueueJob).mockClear();
  vi.mocked(getPublishingConsentStatus).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /models/:modelId/calendar', () => {
  it('returns scheduled posts for the model in range', async () => {
    mockState.result = [
      {
        id: POST_ID,
        bundleId: BUNDLE_ID,
        platform: 'instagram',
        scheduledFor: '2026-08-10T12:00:00Z',
        state: 'pending',
      },
    ];
    const res = await appWithOrg(ORG_ID).request(
      `/models/${MODEL_ID}/calendar?from=2026-08-01T00:00:00Z&to=2026-08-31T00:00:00Z`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].platform).toBe('instagram');
  });

  it('returns an empty list when no posts scheduled', async () => {
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/calendar`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([]);
  });

  it('rejects an invalid range timestamp before querying', async () => {
    const res = await appWithOrg(ORG_ID).request(
      `/models/${MODEL_ID}/calendar?from=not-a-timestamp`,
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /posts', () => {
  it('rejects scheduling when the compliance record set is incomplete', async () => {
    mockState.result = [
      {
        id: BUNDLE_ID,
        orgId: ORG_ID,
        modelId: MODEL_ID,
        state: 'approved',
        assetId: 'asset-1',
      },
    ];
    vi.mocked(getPublishingConsentStatus).mockResolvedValueOnce({
      ok: false,
      missing: ['model_release'],
    });

    const res = await appWithOrg(ORG_ID).request('/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bundleId: BUNDLE_ID,
        platform: 'instagram',
        scheduledFor: '2026-08-10T12:00:00Z',
      }),
    });

    expect(res.status).toBe(409);
    expect(((await res.json()) as any).detail).toContain('consent required for instagram');
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('schedules a post target (201)', async () => {
    mockState.result = [
      {
        id: POST_ID,
        orgId: ORG_ID,
        bundleId: BUNDLE_ID,
        platform: 'instagram',
        scheduledFor: new Date('2026-08-10T12:00:00Z'),
        state: 'pending',
      },
    ];
    mockState.results = [
      [],
      [{ id: BUNDLE_ID, orgId: ORG_ID, modelId: MODEL_ID, state: 'approved', assetId: 'asset-1' }],
      [{ id: 'asset-1', kind: 'image' }],
      mockState.result,
    ];
    const res = await appWithOrg(ORG_ID).request('/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bundleId: BUNDLE_ID,
        platform: 'instagram',
        scheduledFor: '2026-08-10T12:00:00Z',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.state).toBe('pending');
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'publish.target',
        payload: { targetId: POST_ID },
      }),
    );
  });

  it('rejects scheduling when the bundle asset is not owned by its org and model', async () => {
    mockState.results = [
      [],
      [
        {
          id: BUNDLE_ID,
          orgId: ORG_ID,
          modelId: MODEL_ID,
          state: 'approved',
          assetId: 'asset-missing',
        },
      ],
      [],
    ];

    const res = await appWithOrg(ORG_ID).request('/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bundleId: BUNDLE_ID,
        platform: 'instagram',
        scheduledFor: '2026-08-10T12:00:00Z',
      }),
    });

    expect(res.status).toBe(409);
    expect(((await res.json()) as any).detail).toContain('unavailable or unsupported media asset');
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('rejects scheduling a media-only platform when the bundle has no asset', async () => {
    mockState.result = [{ id: BUNDLE_ID, orgId: ORG_ID, state: 'approved', assetId: null }];
    const res = await appWithOrg(ORG_ID).request('/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bundleId: BUNDLE_ID,
        platform: 'instagram',
        scheduledFor: '2026-08-10T12:00:00Z',
      }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).detail).toContain('requires media');
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('rejects scheduling a bundle that is not approved (409)', async () => {
    mockState.result = [{ id: BUNDLE_ID, orgId: ORG_ID, state: 'generated' }];
    const res = await appWithOrg(ORG_ID).request('/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bundleId: BUNDLE_ID,
        platform: 'instagram',
        scheduledFor: '2026-08-10T12:00:00Z',
      }),
    });
    expect(res.status).toBe(409);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('rejects scheduling a bundle outside the organization (404)', async () => {
    const res = await appWithOrg(ORG_ID).request('/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bundleId: BUNDLE_ID,
        platform: 'instagram',
        scheduledFor: '2026-08-10T12:00:00Z',
      }),
    });
    expect(res.status).toBe(404);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('rejects an unsupported platform before scheduling (400)', async () => {
    const res = await appWithOrg(ORG_ID).request('/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bundleId: BUNDLE_ID,
        platform: 'onlyfans',
        scheduledFor: '2026-08-10T12:00:00Z',
      }),
    });
    expect(res.status).toBe(400);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('rejects a missing bundleId (400)', async () => {
    const res = await appWithOrg(ORG_ID).request('/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'instagram', scheduledFor: '2026-08-10T12:00:00Z' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a bad datetime (400)', async () => {
    const res = await appWithOrg(ORG_ID).request('/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bundleId: BUNDLE_ID,
        platform: 'instagram',
        scheduledFor: 'not-a-date',
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /posts/:id', () => {
  it('rejects caller-supplied publication state transitions (400)', async () => {
    const res = await appWithOrg(ORG_ID).request(`/posts/${POST_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'published' }),
    });
    expect(res.status).toBe(400);
  });

  it('reschedules a post', async () => {
    const pendingPost = {
      id: POST_ID,
      orgId: ORG_ID,
      bundleId: BUNDLE_ID,
      platform: 'instagram',
      scheduledFor: new Date('2026-08-12T12:00:00Z'),
      state: 'pending',
    };
    mockState.result = [pendingPost];
    mockState.results = [
      [],
      [pendingPost],
      [{ modelId: MODEL_ID, assetId: 'asset-1' }],
      [{ id: 'asset-1', kind: 'image' }],
      [pendingPost],
    ];
    const res = await appWithOrg(ORG_ID).request(`/posts/${POST_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scheduledFor: '2026-08-12T12:00:00Z' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.scheduledFor).toBeTruthy();
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'publish.target',
        payload: { targetId: POST_ID },
        runAfter: new Date('2026-08-12T12:00:00Z'),
      }),
    );
  });

  it('rejects an unsupported retarget platform', async () => {
    const res = await appWithOrg(ORG_ID).request(`/posts/${POST_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'onlyfans' }),
    });
    expect(res.status).toBe(400);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('rejects retargeting a text-only bundle to a media-only platform', async () => {
    mockState.results = [
      [],
      [
        {
          id: POST_ID,
          orgId: ORG_ID,
          bundleId: BUNDLE_ID,
          platform: 'x',
          scheduledFor: new Date('2026-08-10T12:00:00Z'),
          state: 'pending',
        },
      ],
      [{ assetId: null }],
    ];

    const res = await appWithOrg(ORG_ID).request(`/posts/${POST_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'instagram' }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).detail).toContain('requires media');
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('rejects edits after the worker has started publication', async () => {
    mockState.result = [
      {
        id: POST_ID,
        orgId: ORG_ID,
        bundleId: BUNDLE_ID,
        platform: 'instagram',
        scheduledFor: new Date('2026-08-10T12:00:00Z'),
        state: 'published',
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/posts/${POST_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scheduledFor: '2026-08-12T12:00:00Z' }),
    });
    expect(res.status).toBe(409);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('rejects an empty edit', async () => {
    const res = await appWithOrg(ORG_ID).request(`/posts/${POST_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the post is not in the org', async () => {
    const res = await appWithOrg(ORG_ID).request(`/posts/${POST_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scheduledFor: '2026-08-12T12:00:00Z' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /posts/:id', () => {
  it('cancels a pending post before provider handoff (200)', async () => {
    mockState.results = [
      [],
      [{ id: POST_ID, state: 'pending', remoteId: null }],
      [],
      [{ id: POST_ID, state: 'canceled' }],
    ];
    const res = await appWithOrg(ORG_ID).request(`/posts/${POST_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ id: POST_ID, state: 'canceled' });
  });

  it('rejects cancellation after provider handoff has started (409)', async () => {
    mockState.results = [[], [{ id: POST_ID, state: 'pending', remoteId: 'provider-publish-id' }]];
    const res = await appWithOrg(ORG_ID).request(`/posts/${POST_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).detail).toContain(
      'post cannot be unscheduled after publication begins',
    );
  });

  it('preserves a pending target when a prior provider outcome is unknown (409)', async () => {
    mockState.results = [
      [],
      [{ id: POST_ID, state: 'pending', remoteId: null }],
      [{ id: 'dead-job' }],
    ];
    const res = await appWithOrg(ORG_ID).request(`/posts/${POST_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).detail).toContain(
      'provider outcome is unknown; reconcile the dead job',
    );
  });

  it('returns 404 when the post is not in the org', async () => {
    const res = await appWithOrg(ORG_ID).request(`/posts/${POST_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
