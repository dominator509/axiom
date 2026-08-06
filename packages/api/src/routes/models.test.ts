// ─── Models Router (real DB-backed) — Vitest Suite ───
// Covers: org-scoped list/get/create/update/delete with the chainable
// @axiom/db mock (same pattern as egress.test.ts). Validation errors and
// missing-org 401s are exercised directly; CRUD paths exercise the mocked
// transaction chain.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ modelProfile: {} }));

import { modelsRouter } from './models.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', modelsRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET / — list models', () => {
  it('returns rows from the org-scoped query', async () => {
    mockState.result = [
      { id: MODEL_ID, orgId: ORG_ID, displayName: 'Luna Vex', handle: 'lunavex', isActive: true },
    ];
    const res = await appWithOrg(ORG_ID).request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].displayName).toBe('Luna Vex');
    expect(body.meta.total).toBe(1);
  });

  it('returns an empty list when the org has no models', async () => {
    const res = await appWithOrg(ORG_ID).request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });

  it('rejects a request without org context (401)', async () => {
    const res = await appWithOrg(null).request('/');
    expect(res.status).toBe(401);
  });
});

describe('GET /:id — get single model', () => {
  it('returns the model when found in the org', async () => {
    mockState.result = [{ id: MODEL_ID, orgId: ORG_ID, displayName: 'Luna Vex', handle: 'lunavex' }];
    const res = await appWithOrg(ORG_ID).request(`/${MODEL_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.id).toBe(MODEL_ID);
  });

  it('returns 404 when the model is not in the org', async () => {
    const res = await appWithOrg(ORG_ID).request(`/${MODEL_ID}`);
    expect(res.status).toBe(404);
  });
});

describe('POST / — create model', () => {
  it('creates a model with orgId and audits the create', async () => {
    mockState.result = [{ id: MODEL_ID, orgId: ORG_ID, displayName: 'Luna Vex', handle: 'lunavex' }];
    const res = await appWithOrg(ORG_ID).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Luna Vex', handle: 'lunavex', bio: 'alt model' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.id).toBe(MODEL_ID);
    expect(body.data.orgId).toBe(ORG_ID);
  });

  it('rejects a missing displayName', async () => {
    const res = await appWithOrg(ORG_ID).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'nohandle' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an empty handle', async () => {
    const res = await appWithOrg(ORG_ID).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'X', handle: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a displayName longer than 100 chars', async () => {
    const res = await appWithOrg(ORG_ID).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'x'.repeat(101), handle: 'h' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a bio longer than 500 chars', async () => {
    const res = await appWithOrg(ORG_ID).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'X', handle: 'h', bio: 'y'.repeat(501) }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid JSON body', async () => {
    const res = await appWithOrg(ORG_ID).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /:id — update model', () => {
  it('updates fields and returns the updated row', async () => {
    mockState.result = [{ id: MODEL_ID, orgId: ORG_ID, displayName: 'New Name', handle: 'lunavex' }];
    const res = await appWithOrg(ORG_ID).request(`/${MODEL_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'New Name', avatarUrl: 'https://cdn.example.com/a.png' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.displayName).toBe('New Name');
  });

  it('returns 404 when the model is not in the org', async () => {
    const res = await appWithOrg(ORG_ID).request(`/${MODEL_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'X' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects an invalid avatarUrl', async () => {
    const res = await appWithOrg(ORG_ID).request(`/${MODEL_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ avatarUrl: 'not-a-url' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /:id — delete model', () => {
  it('soft-deletes and returns success', async () => {
    mockState.result = [{ id: MODEL_ID, orgId: ORG_ID, isActive: false }];
    const res = await appWithOrg(ORG_ID).request(`/${MODEL_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.isActive).toBe(false);
  });

  it('returns 404 when the model is not in the org', async () => {
    const res = await appWithOrg(ORG_ID).request(`/${MODEL_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
