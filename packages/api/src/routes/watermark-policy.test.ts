import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockDbFactory, mockState } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ watermarkPolicy: {}, modelProfile: {} }));
vi.mock('./helpers.js', async () => {
  const actual = await vi.importActual<typeof import('./helpers.js')>('./helpers.js');
  return { ...actual, writeAudit: vi.fn().mockResolvedValue(undefined) };
});

import { watermarkPolicyRouter } from './watermark-policy.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const WATERMARK_KEY = `generated/${ORG_ID}/${MODEL_ID}/wm.png`;
const ENABLED_ROW = {
  id: '33333333-3333-4333-8333-333333333333',
  orgId: ORG_ID,
  modelId: MODEL_ID,
  enabled: true,
  watermarkKey: WATERMARK_KEY,
  position: 'top-left',
  opacity: 40,
  scale: 50,
};

function appWithContext(role: string, orgId: string | null = ORG_ID) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    c.set('role', role as any);
    await next();
  });
  app.route('/', watermarkPolicyRouter);
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

describe('F-14 watermark policy API', () => {
  it('requires an authenticated tenant and exposes the disabled default', async () => {
    expect((await appWithContext('owner', null).request(`/models/${MODEL_ID}/watermark-policy`)).status).toBe(401);
    const response = await appWithContext('operator').request(`/models/${MODEL_ID}/watermark-policy`);
    expect(response.status).toBe(200);
    expect((await response.json() as any).data.policy).toEqual({
      enabled: false,
      watermarkKey: null,
      position: 'bottom-right',
      opacity: 60,
      scale: 100,
    });
  });

  it('returns the persisted policy when a row exists', async () => {
    mockState.result = [ENABLED_ROW];
    const response = await appWithContext('operator').request(`/models/${MODEL_ID}/watermark-policy`);
    expect(response.status).toBe(200);
    expect((await response.json() as any).data.policy).toEqual({
      enabled: true,
      watermarkKey: WATERMARK_KEY,
      position: 'top-left',
      opacity: 40,
      scale: 50,
    });
  });

  it('rejects out-of-range opacity, scale, position, and unknown fields', async () => {
    const path = `/models/${MODEL_ID}/watermark-policy`;
    const cases = [
      { enabled: true, watermarkKey: WATERMARK_KEY, opacity: 101 },
      { enabled: true, watermarkKey: WATERMARK_KEY, scale: 4 },
      { enabled: true, watermarkKey: WATERMARK_KEY, scale: 101 },
      { enabled: true, watermarkKey: WATERMARK_KEY, position: 'somewhere' },
      { enabled: true, watermarkKey: WATERMARK_KEY, cdnUrl: 'https://example.invalid/wm.png' },
      { enabled: true, watermarkKey: `generated/${ORG_ID}/00000000-0000-4000-8000-000000000003/wm.png` },
    ];
    for (const body of cases) {
      const response = await appWithContext('owner').request(path, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
  });

  it('fails closed: an enabled policy must name a key and a disabled policy must not', async () => {
    const path = `/models/${MODEL_ID}/watermark-policy`;
    expect((await appWithContext('owner').request(path, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })).status).toBe(400);
    expect((await appWithContext('owner').request(path, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false, watermarkKey: WATERMARK_KEY }),
    })).status).toBe(400);
  });

  it('denies operator writes but allows a manager to upsert', async () => {
    const path = `/models/${MODEL_ID}/watermark-policy`;
    const body = { enabled: true, watermarkKey: WATERMARK_KEY, position: 'center', opacity: 25, scale: 75 };
    expect((await appWithContext('operator').request(path, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })).status).toBe(403);

    // Authorized model lookup succeeds, then the upsert returns the saved row.
    mockState.results = [[], [{ id: MODEL_ID }], [ENABLED_ROW]];
    const response = await appWithContext('manager').request(path, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    expect(mockState.insertValues[0]).toMatchObject({
      orgId: ORG_ID, modelId: MODEL_ID, enabled: true, watermarkKey: WATERMARK_KEY, position: 'center', opacity: 25, scale: 75,
    });
  });

  it('strips the key when a policy is disabled and rejects a cross-scope model', async () => {
    const path = `/models/${MODEL_ID}/watermark-policy`;
    // Disabled with no key: authorized model, upsert returns the disabled row.
    mockState.results = [[], [{ id: MODEL_ID }], [{ ...ENABLED_ROW, enabled: false, watermarkKey: null }]];
    const ok = await appWithContext('owner').request(path, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(ok.status).toBe(200);
    expect(mockState.insertValues[0]).toMatchObject({ enabled: false, watermarkKey: null });

    // Model outside the caller's scope is not found.
    mockState.results = [[], []];
    const denied = await appWithContext('owner').request(path, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, watermarkKey: WATERMARK_KEY }),
    });
    expect(denied.status).toBe(404);
  });
});
