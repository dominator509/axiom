// ─── Models Router — Vitest Suite ───
// Covers: list, get, create (zod validation), update, delete.

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let router: any;

beforeAll(async () => {
  const mod = await import('./models.js');
  router = mod.modelsRouter;
});

// Wrapper app that injects orgId (as real middleware would) so create handlers
// can read it via c.get('orgId').
function appWithOrg(orgId: string) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('orgId', orgId);
    await next();
  });
  app.route('/', router);
  return app;
}

describe('GET / — list models', () => {
  it('returns an empty list with meta', async () => {
    const res = await router.request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual({ data: [], meta: { total: 0 } });
  });
});

describe('GET /:id — get single model', () => {
  it('returns null data for any id', async () => {
    const res = await router.request('/model-123');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual({ data: null });
  });
});

describe('POST / — create model', () => {
  it('creates a model with id, echoed body and orgId', async () => {
    const res = await appWithOrg('org-abc').request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Luna Vex', handle: 'lunavex', bio: 'alt model' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.id).toMatch(UUID_RE);
    expect(body.data.displayName).toBe('Luna Vex');
    expect(body.data.handle).toBe('lunavex');
    expect(body.data.bio).toBe('alt model');
    expect(body.data.orgId).toBe('org-abc');
  });

  it('accepts a model without an optional bio', async () => {
    const res = await appWithOrg('org-abc').request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'No Bio', handle: 'nobio' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.displayName).toBe('No Bio');
    expect(body.data.bio).toBeUndefined();
  });

  it('rejects a missing displayName', async () => {
    const res = await router.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'nohandle' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an empty handle', async () => {
    const res = await router.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'X', handle: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a displayName longer than 100 chars', async () => {
    const res = await router.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'x'.repeat(101), handle: 'h' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a bio longer than 500 chars', async () => {
    const res = await router.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'X', handle: 'h', bio: 'y'.repeat(501) }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid JSON body', async () => {
    const res = await router.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /:id — update model', () => {
  it('updates fields and echoes them with the id', async () => {
    const res = await router.request('/model-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'New Name', avatarUrl: 'https://cdn.example.com/a.png' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual({
      id: 'model-1',
      displayName: 'New Name',
      avatarUrl: 'https://cdn.example.com/a.png',
    });
  });

  it('accepts an empty update (all fields optional) and returns only the id', async () => {
    const res = await router.request('/model-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual({ id: 'model-1' });
  });

  it('rejects an invalid avatarUrl', async () => {
    const res = await router.request('/model-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ avatarUrl: 'not-a-url' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an over-long displayName', async () => {
    const res = await router.request('/model-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'x'.repeat(101) }),
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /:id — delete model', () => {
  it('returns success for any id', async () => {
    const res = await router.request('/model-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual({ success: true });
  });
});
