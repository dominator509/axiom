// ─── Bundles Router — Vitest Suite ───
// Covers: list, get, create (zod validation), state transitions.

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MODEL_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';

let router: any;

beforeAll(async () => {
  const mod = await import('./bundles.js');
  router = mod.bundlesRouter;
});

function appWithOrg(orgId: string) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('orgId', orgId);
    await next();
  });
  app.route('/', router);
  return app;
}

describe('GET / — list bundles', () => {
  it('returns an empty list with meta', async () => {
    const res = await router.request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [], meta: { total: 0 } });
  });
});

describe('GET /:id — get bundle', () => {
  it('returns null data for any id', async () => {
    const res = await router.request('/bundle-1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
  });
});

describe('POST / — create bundle', () => {
  it('creates a bundle in generated state with timestamps and orgId', async () => {
    const res = await appWithOrg('org-b1').request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        modelId: MODEL_ID,
        assetIds: [ASSET_ID],
        captions: { instagram: 'hello' },
        hashtags: ['#summer'],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.id).toMatch(UUID_RE);
    expect(body.data.modelId).toBe(MODEL_ID);
    expect(body.data.assetIds).toEqual([ASSET_ID]);
    expect(body.data.captions).toEqual({ instagram: 'hello' });
    expect(body.data.hashtags).toEqual(['#summer']);
    expect(body.data.state).toBe('generated');
    expect(body.data.orgId).toBe('org-b1');
    expect(new Date(body.data.createdAt).toISOString()).toBe(body.data.createdAt);
  });

  it('accepts a bundle with only a modelId', async () => {
    const res = await appWithOrg('org-b1').request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.modelId).toBe(MODEL_ID);
    expect(body.data.assetIds).toBeUndefined();
  });

  it('rejects a non-uuid modelId', async () => {
    const res = await router.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: 'not-a-uuid' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a missing modelId', async () => {
    const res = await router.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a non-uuid asset id', async () => {
    const res = await router.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, assetIds: ['nope'] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid JSON body', async () => {
    const res = await router.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{broken',
    });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /:id/state — transition bundle state', () => {
  const validStates = ['generated', 'approved', 'rejected', 'scheduled', 'publishing', 'published', 'failed'];

  it.each(validStates)('accepts state "%s"', async (state) => {
    const res = await router.request('/bundle-1/state', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual({ id: 'bundle-1', state });
  });

  it('rejects an unknown state value', async () => {
    const res = await router.request('/bundle-1/state', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'bogus' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a missing state field', async () => {
    const res = await router.request('/bundle-1/state', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a numeric state', async () => {
    const res = await router.request('/bundle-1/state', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 42 }),
    });
    expect(res.status).toBe(400);
  });
});
