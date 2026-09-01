// ─── Social Router (real DB-backed) — Vitest Suite ───
// Covers: org-scoped list/connect/revoke for platform_connection with
// envelope-encrypted credentials (LBI-01).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ platformConnection: {} }));
vi.mock('@axiom/worker', () => ({
  resolveCapabilities: vi.fn(() => ({
    publish: true,
    media: ['image', 'carousel'],
    maxMediaBytes: 100,
    maxMediaCount: 2,
    caption: true,
    maxCaptionLength: 100,
    scheduling: 'native',
    metrics: ['likes'],
    refreshMetrics: true,
  })),
  capabilityNames: vi.fn(() => [
    'publish',
    'publish.image',
    'publish.carousel',
    'schedule.native',
    'read.insights',
  ]),
  connectorForConnection: vi.fn(async () => ({
    connection: {},
    connector: { revoke: vi.fn(async () => undefined) },
  })),
}));

import { socialRouter } from './social.js';
import { capabilityNames, connectorForConnection, resolveCapabilities } from '@axiom/worker';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const CONN_ID = '33333333-3333-4333-8333-333333333333';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', socialRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET / — list connections', () => {
  it('returns connections for the org (filtered by modelId)', async () => {
    mockState.result = [
      {
        id: CONN_ID,
        orgId: ORG_ID,
        modelId: MODEL_ID,
        platform: 'instagram',
        displayName: '@luna',
        status: 'connected',
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/?modelId=${MODEL_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].platform).toBe('instagram');
  });

  it('returns an empty list when nothing is connected', async () => {
    const res = await appWithOrg(ORG_ID).request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([]);
  });

  it('rejects without org context (401)', async () => {
    const res = await appWithOrg(null).request('/');
    expect(res.status).toBe(401);
  });
});

describe('POST / — connect', () => {
  const body = {
    platform: 'instagram',
    displayName: '@luna',
    encToken: Buffer.from('cipher').toString('base64'),
    encNonce: Buffer.from('n'.repeat(24)).toString('base64'),
    dekId: 'egress-dek',
    // Legacy client capability claims must not control the persisted value.
    capabilities: ['client-controlled'],
  };

  it('connects a platform account (201)', async () => {
    mockState.result = [
      {
        id: CONN_ID,
        orgId: ORG_ID,
        modelId: MODEL_ID,
        platform: 'instagram',
        displayName: '@luna',
        status: 'connected',
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/?modelId=${MODEL_ID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(201);
    const resBody = (await res.json()) as any;
    expect(resBody.data.platform).toBe('instagram');
    expect(resolveCapabilities).toHaveBeenCalledWith('instagram');
    expect(capabilityNames).toHaveBeenCalled();
  });

  it('rejects an unknown platform (400)', async () => {
    const res = await appWithOrg(ORG_ID).request(`/?modelId=${MODEL_ID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, platform: 'myspace' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a missing modelId query (400)', async () => {
    const res = await appWithOrg(ORG_ID).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing encToken (400)', async () => {
    const res = await appWithOrg(ORG_ID).request(`/?modelId=${MODEL_ID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, encToken: undefined }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects connecting an account for a model outside the organization', async () => {
    mockState.result = [];
    const res = await appWithOrg(ORG_ID).request(`/?modelId=${MODEL_ID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /:id — revoke', () => {
  it('revokes a connection and audits (200)', async () => {
    mockState.result = [{ id: CONN_ID, platform: 'instagram' }];
    const res = await appWithOrg(ORG_ID).request(`/${CONN_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.platform).toBe('instagram');
    expect(connectorForConnection).toHaveBeenCalledTimes(1);
  });

  it('retains the local connection when provider revocation fails (502)', async () => {
    mockState.result = [{ id: CONN_ID, platform: 'instagram' }];
    vi.mocked(connectorForConnection).mockRejectedValueOnce(new Error('egress unavailable'));
    const res = await appWithOrg(ORG_ID).request(`/${CONN_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(502);
    const body = (await res.json()) as any;
    expect(body.detail).toContain('local connection was retained');
  });

  it('returns 404 when the connection is not in the org', async () => {
    const res = await appWithOrg(ORG_ID).request(`/${CONN_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
