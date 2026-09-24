import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockDbFactory, mockState } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ providerCacheControl: {}, modelProfile: {} }));
vi.mock('./helpers.js', async () => {
  const actual = await vi.importActual<typeof import('./helpers.js')>('./helpers.js');
  return { ...actual, writeAudit: vi.fn().mockResolvedValue(undefined) };
});

import { providerCacheControlsRouter } from './provider-cache-controls.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';

function appWithContext(role: string, orgId: string | null = ORG_ID) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    c.set('role', role as any);
    await next();
  });
  app.route('/', providerCacheControlsRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
  mockState.results = [];
  mockState.updates = [];
  mockState.conflictUpdates = [];
  mockState.insertValues = [];
  vi.clearAllMocks();
});

describe('F-33 provider cache controls API', () => {
  it('requires an authenticated tenant and exposes disabled defaults', async () => {
    expect((await appWithContext('owner', null).request(`/models/${MODEL_ID}/cache-controls`)).status).toBe(401);
    const response = await appWithContext('operator').request(`/models/${MODEL_ID}/cache-controls`);
    expect(response.status).toBe(200);
    expect((await response.json() as any).data.controls).toEqual([
      { provider: 'deepseek', enabled: false, prefixAlignment: false, promptCacheKey: null },
      { provider: 'anthropic', enabled: false, prefixAlignment: false, promptCacheKey: null },
      { provider: 'openai', enabled: false, prefixAlignment: false, promptCacheKey: null },
    ]);
  });

  it('rejects unknown providers, secret-shaped fields, and operator writes', async () => {
    const path = `/models/${MODEL_ID}/cache-controls`;
    expect((await appWithContext('owner').request(path, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'grok', enabled: true }),
    })).status).toBe(400);
    expect((await appWithContext('owner').request(path, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', enabled: true, apiKey: 'secret' }),
    })).status).toBe(400);
    expect((await appWithContext('operator').request(path, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', enabled: true }),
    })).status).toBe(403);
  });

  it('writes only bounded controls and returns a safe projection', async () => {
    mockState.results = [
      [],
      [{ id: MODEL_ID }],
      [{ id: 'control-1', provider: 'openai', enabled: true, prefixAlignment: false, promptCacheKey: 'model:v1' }],
    ];
    const response = await appWithContext('manager').request(`/models/${MODEL_ID}/cache-controls`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', enabled: true, promptCacheKey: 'model:v1' }),
    });
    expect(response.status).toBe(200);
    expect(mockState.insertValues[0]).toMatchObject({ orgId: ORG_ID, modelId: MODEL_ID, provider: 'openai', enabled: true });
    expect(await response.json()).toEqual({ success: true, data: {
      provider: 'openai', enabled: true, prefixAlignment: false, promptCacheKey: 'model:v1',
    } });
  });
});
