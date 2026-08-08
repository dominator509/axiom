// ─── Network / egress per model (F-02) — Vitest Suite ───
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ modelNetworkConfigs: {} }));

import { networkRouter } from './network.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', networkRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /:modelId/network', () => {
  it('returns the egress config + health when a config exists', async () => {
    mockState.result = [
      {
        id: 'cfg-1',
        orgId: ORG_ID,
        modelId: MODEL_ID,
        egressMode: 'wireguard',
        healthy: true,
        latencyMs: 120,
        lastEgressIp: '203.0.113.7',
        failCount: 0,
        lastError: null,
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/${MODEL_ID}/network`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.egressMode).toBe('wireguard');
    expect(body.data.healthy).toBe(true);
  });

  it('returns a direct-default shape when no config exists', async () => {
    const res = await appWithOrg(ORG_ID).request(`/${MODEL_ID}/network`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.egressMode).toBe('direct');
    expect(body.data.healthy).toBe(false);
  });

  it('rejects without org context (401)', async () => {
    const res = await appWithOrg(null).request(`/${MODEL_ID}/network`);
    expect(res.status).toBe(401);
  });
});

describe('PUT /:modelId/network', () => {
  it('updates an existing config', async () => {
    mockState.result = [
      {
        id: 'cfg-1',
        orgId: ORG_ID,
        modelId: MODEL_ID,
        egressMode: 'socks5',
        proxyAddr: '127.0.0.1:1080',
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/${MODEL_ID}/network`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ egressMode: 'socks5', proxyAddr: '127.0.0.1:1080' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.egressMode).toBe('socks5');
  });

  it('rejects an invalid egress mode (400)', async () => {
    const res = await appWithOrg(ORG_ID).request(`/${MODEL_ID}/network`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ egressMode: 'quantum' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /:modelId/network/health', () => {
  it('returns DB state and best-effort live plane state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ healthy: true, egress_ip: '66.94.123.250' }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    mockState.result = [
      {
        orgId: ORG_ID,
        modelId: MODEL_ID,
        healthy: true,
        lastCheck: null,
        latencyMs: 171,
        lastEgressIp: '66.94.123.250',
        failCount: 0,
        lastError: null,
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/${MODEL_ID}/network/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.modelId).toBe(MODEL_ID);
    expect(body.data.live).toBeTruthy();
    expect(body.data.db.healthy).toBe(true);
  });

  it('degrades gracefully when the plane is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    mockState.result = [];
    const res = await appWithOrg(ORG_ID).request(`/${MODEL_ID}/network/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.live).toBeNull();
    expect(body.data.db.healthy).toBe(false);
  });
});
