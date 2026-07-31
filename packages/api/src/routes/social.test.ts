// ─── Social Connections Router — Vitest Suite ───
// Covers: list, get, create (zod validation), revoke, refresh.

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MODEL_ID = '11111111-1111-4111-8111-111111111111';

let router: any;

beforeAll(async () => {
  const mod = await import('./social.js');
  router = mod.socialRouter;
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

describe('GET / — list connections', () => {
  it('returns an empty list with meta', async () => {
    const res = await router.request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [], meta: { total: 0 } });
  });
});

describe('GET /:id — get connection', () => {
  it('returns null data for any id', async () => {
    const res = await router.request('/conn-1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
  });
});

describe('POST / — create connection', () => {
  it('creates an active connection with orgId and connectedAt', async () => {
    const res = await appWithOrg('org-s1').request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, platform: 'instagram', displayName: 'Luna IG' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.id).toMatch(UUID_RE);
    expect(body.data.modelId).toBe(MODEL_ID);
    expect(body.data.platform).toBe('instagram');
    expect(body.data.displayName).toBe('Luna IG');
    expect(body.data.status).toBe('active');
    expect(body.data.orgId).toBe('org-s1');
    expect(new Date(body.data.connectedAt).toISOString()).toBe(body.data.connectedAt);
  });

  it('accepts an optional authCode', async () => {
    const res = await appWithOrg('org-s1').request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, platform: 'fanvue', displayName: 'FV', authCode: 'xyz' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.authCode).toBe('xyz');
  });

  it.each(['instagram', 'tiktok', 'x', 'youtube', 'reddit', 'threads', 'discord', 'telegram', 'facebook', 'snapchat', 'fanvue'])(
    'accepts platform "%s"',
    async (platform) => {
      const res = await router.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelId: MODEL_ID, platform, displayName: 'D' }),
      });
      expect(res.status).toBe(201);
    },
  );

  it('rejects an unsupported platform', async () => {
    const res = await router.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, platform: 'myspace', displayName: 'D' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a missing modelId', async () => {
    const res = await router.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'instagram', displayName: 'D' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an empty displayName', async () => {
    const res = await router.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, platform: 'instagram', displayName: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a displayName longer than 100 chars', async () => {
    const res = await router.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, platform: 'instagram', displayName: 'x'.repeat(101) }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid JSON body', async () => {
    const res = await router.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'oops',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /:id/revoke — revoke connection', () => {
  it('marks the connection revoked', async () => {
    const res = await router.request('/conn-9/revoke', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { id: 'conn-9', status: 'revoked' } });
  });
});

describe('POST /:id/refresh — refresh token', () => {
  it('marks the connection refreshed', async () => {
    const res = await router.request('/conn-9/refresh', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { id: 'conn-9', status: 'refreshed' } });
  });
});
