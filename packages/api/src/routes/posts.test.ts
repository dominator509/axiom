// ─── Posts / calendar (F-10) — Vitest Suite ───
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ postTarget: {}, contentBundle: {} }));

import { postsRouter } from './posts.js';

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
});

describe('POST /posts', () => {
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
  it('reschedules a post', async () => {
    mockState.result = [
      {
        id: POST_ID,
        orgId: ORG_ID,
        bundleId: BUNDLE_ID,
        platform: 'instagram',
        scheduledFor: new Date('2026-08-12T12:00:00Z'),
        state: 'pending',
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/posts/${POST_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scheduledFor: '2026-08-12T12:00:00Z' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.scheduledFor).toBeTruthy();
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
  it('unschedules a post (200)', async () => {
    mockState.result = [{ id: POST_ID }];
    const res = await appWithOrg(ORG_ID).request(`/posts/${POST_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
  });

  it('returns 404 when the post is not in the org', async () => {
    const res = await appWithOrg(ORG_ID).request(`/posts/${POST_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
