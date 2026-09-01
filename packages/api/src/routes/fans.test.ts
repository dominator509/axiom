// ─── Fan CRM (F-05..F-08) — Vitest Suite ───
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () =>
  mockDbFactory({ fanCrmContact: {}, fanTouchpoint: {}, customRequest: {} }),
);

import { fansRouter } from './fans.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const FAN_ID = '33333333-3333-4333-8333-333333333333';
const REQ_ID = '44444444-4444-4444-8444-444444444444';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', fansRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /models/:modelId/fans', () => {
  it('returns fan contacts for the model', async () => {
    mockState.result = [
      {
        id: FAN_ID,
        orgId: ORG_ID,
        modelId: MODEL_ID,
        platform: 'fanvue',
        displayName: 'WhaleFan',
        tier: 'whale',
        lifetimeValueUsd: '1200.00',
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/fans`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].tier).toBe('whale');
  });

  it('filters by tier', async () => {
    mockState.result = [
      { id: FAN_ID, orgId: ORG_ID, modelId: MODEL_ID, platform: 'fanvue', tier: 'whale' },
    ];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/fans?tier=whale`);
    expect(res.status).toBe(200);
  });

  it('returns an empty list when no fans', async () => {
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/fans`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([]);
  });
});

describe('POST /models/:modelId/fans — upsert', () => {
  it('upserts a fan contact (201)', async () => {
    mockState.result = [
      {
        id: FAN_ID,
        orgId: ORG_ID,
        modelId: MODEL_ID,
        platform: 'fanvue',
        externalId: 'ext-1',
        tier: 'new',
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/fans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        modelId: MODEL_ID,
        platform: 'fanvue',
        externalId: 'ext-1',
        displayName: 'Fan One',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.tier).toBe('new');
  });

  it('rejects missing externalId (400)', async () => {
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/fans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'fanvue' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid tier (400)', async () => {
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/fans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'fanvue', externalId: 'x', tier: 'superfan' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a contact for a model outside the organization', async () => {
    mockState.result = [];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/fans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, platform: 'fanvue', externalId: 'x' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /fans/:fanId — unified timeline', () => {
  it('returns fan + touchpoints + requests', async () => {
    mockState.result = [
      {
        id: FAN_ID,
        orgId: ORG_ID,
        modelId: MODEL_ID,
        platform: 'fanvue',
        displayName: 'Fan',
        tier: 'loyal',
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/fans/${FAN_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.fan.id).toBe(FAN_ID);
    expect(body.data.touchpoints).toBeDefined();
  });

  it('returns 404 when the fan is not in the org', async () => {
    const res = await appWithOrg(ORG_ID).request(`/fans/${FAN_ID}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /fans/:fanId/touchpoints', () => {
  it('records a touchpoint (201)', async () => {
    mockState.result = [
      { id: 'tp-1', orgId: ORG_ID, fanId: FAN_ID, platform: 'x', kind: 'dm', direction: 'inbound' },
    ];
    const res = await appWithOrg(ORG_ID).request(`/fans/${FAN_ID}/touchpoints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fanId: FAN_ID, platform: 'x', kind: 'dm' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.kind).toBe('dm');
  });

  it('rejects a touchpoint for a fan outside the organization', async () => {
    mockState.result = [];
    const res = await appWithOrg(ORG_ID).request(`/fans/${FAN_ID}/touchpoints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fanId: FAN_ID, platform: 'x', kind: 'dm' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /custom-requests', () => {
  it('creates a ticket in pending state (201)', async () => {
    mockState.result = [
      { id: REQ_ID, orgId: ORG_ID, modelId: MODEL_ID, title: 'Custom video', status: 'pending' },
    ];
    const res = await appWithOrg(ORG_ID).request('/custom-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, title: 'Custom video', priceUsd: 50 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.status).toBe('pending');
  });

  it('rejects a missing title (400)', async () => {
    const res = await appWithOrg(ORG_ID).request('/custom-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a request for a model outside the organization', async () => {
    mockState.result = [];
    const res = await appWithOrg(ORG_ID).request('/custom-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, title: 'Custom video' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /custom-requests/:id', () => {
  it('transitions status (200)', async () => {
    mockState.result = [
      { id: REQ_ID, orgId: ORG_ID, modelId: MODEL_ID, title: 'Custom video', status: 'filming' },
    ];
    const res = await appWithOrg(ORG_ID).request(`/custom-requests/${REQ_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'filming' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.status).toBe('filming');
  });

  it('rejects an invalid status (400)', async () => {
    const res = await appWithOrg(ORG_ID).request(`/custom-requests/${REQ_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'shipped' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the request is not in the org', async () => {
    const res = await appWithOrg(ORG_ID).request(`/custom-requests/${REQ_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'delivered' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /models/:modelId/custom-requests', () => {
  it('lists tickets for the model', async () => {
    mockState.result = [
      { id: REQ_ID, orgId: ORG_ID, modelId: MODEL_ID, title: 'Custom video', status: 'pending' },
    ];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/custom-requests`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
  });
});
