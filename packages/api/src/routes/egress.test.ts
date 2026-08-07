// ─── Egress config router (L2.6) — Vitest Suite ───
// Covers: RLS-scoped DB CRUD (via a mocked @axiom/db transaction chain),
// credential encryption through the plane, plane proxy endpoints, and
// validation/authorization failures.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';

// ── Mock @axiom/db ─────────────────────────────────────────────────────
// The router queries through db.transaction(tx => ...) where tx is a
// drizzle query builder chain. We replace db.transaction with a fake that
// calls the callback with a chainable tx whose awaited result is
// mockState.result — so each test controls what a CRUD query "returns".
const mockState: { result: unknown } = { result: [] };

function makeChain(): any {
  const handler = {
    get(_t: unknown, prop: string | symbol) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
          Promise.resolve(mockState.result).then(resolve, reject);
        };
      }
      return () => makeChain();
    },
    apply() {
      return makeChain();
    },
  };
  return new Proxy(function () {}, handler);
}

vi.mock('@axiom/db', () => ({
  db: {
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const tx = makeChain();
      // tx.execute(...) is awaited first in withOrgContext — no-op chain.
      return cb(tx);
    }),
  },
  schema: {
    modelNetworkConfigs: {},
  },
}));

import { egressRouter } from './egress.js';

const MODEL_ID = '11111111-1111-4111-8111-111111111111';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    await next();
  });
  app.route('/', egressRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const validBody = {
  modelId: MODEL_ID,
  egressMode: 'wireguard',
  wgPublicKey: 'pub',
  wgEndpoint: '203.0.113.1:51820',
  wgAllowedIps: '10.9.0.0/24',
  expectedEgressIp: '203.0.113.7',
};

describe('POST / — create config', () => {
  it('rejects a request without an org context (401)', async () => {
    const res = await appWithOrg(null).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(401);
  });

  it('rejects an invalid egress mode (400)', async () => {
    const res = await appWithOrg('org-1').request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody, egressMode: 'quantum' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a non-uuid modelId (400)', async () => {
    const res = await appWithOrg('org-1').request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody, modelId: 'not-a-uuid' }),
    });
    expect(res.status).toBe(400);
  });

  it('creates a config without credentials (no plane call, 201)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockState.result = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        orgId: 'org-1',
        modelId: MODEL_ID,
        egressMode: 'wireguard',
        healthy: false,
      },
    ];
    const res = await appWithOrg('org-1').request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.modelId).toBe(MODEL_ID);
    expect(body.data.healthy).toBe(false);
    // no credentials → no encrypt round-trip to the plane
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('encrypts credentials via the plane before storing (201)', async () => {
    const encCreds = Buffer.from('cipher').toString('base64');
    const encNonce = Buffer.from('n'.repeat(24)).toString('base64');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ enc_creds: encCreds, enc_nonce: encNonce, dek_id: 'egress-dek' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    mockState.result = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        orgId: 'org-1',
        modelId: MODEL_ID,
        egressMode: 'socks5',
        healthy: false,
      },
    ];
    const res = await appWithOrg('org-1').request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        modelId: MODEL_ID,
        egressMode: 'socks5',
        proxyAddr: '127.0.0.1:1080',
        proxyUsername: 'alice',
        proxyPassword: 's3cret',
      }),
    });
    expect(res.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callUrl = fetchMock.mock.calls[0][0] as string;
    expect(callUrl.endsWith('/egress/encrypt')).toBe(true);
    const callInit = fetchMock.mock.calls[0][1] as { body: string };
    const payload = JSON.parse(callInit.body) as { plaintext: string };
    // plaintext is base64 of the creds JSON — never raw in the request body
    const decoded = Buffer.from(payload.plaintext, 'base64').toString('utf8');
    expect(decoded).toContain('proxy_password');
    expect(callInit.body).not.toContain('s3cret');
  });

  it('returns 502 when the plane cannot encrypt credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('down', { status: 503 })));
    const res = await appWithOrg('org-1').request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        modelId: MODEL_ID,
        egressMode: 'socks5',
        proxyAddr: '127.0.0.1:1080',
        proxyUsername: 'alice',
      }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as any;
    expect(body.detail).toContain('egress plane unreachable');
    expect(body.status).toBe(502);
    expect(body.title).toBe('Bad Gateway');
    expect(body.correlation_id).toBeTruthy();
  });
});

describe('GET / — list configs', () => {
  it('requires org context (401)', async () => {
    const res = await appWithOrg(null).request('/');
    expect(res.status).toBe(401);
  });

  it('returns sanitized rows without encrypted credential fields', async () => {
    mockState.result = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        orgId: 'org-1',
        modelId: MODEL_ID,
        egressMode: 'wireguard',
        healthy: true,
        encCreds: new Uint8Array([1, 2, 3]),
        encNonce: new Uint8Array([4, 5, 6]),
        dekId: 'egress-dek',
      },
    ];
    const res = await appWithOrg('org-1').request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.meta.total).toBe(1);
    expect(body.data[0].modelId).toBe(MODEL_ID);
    expect(body.data[0]).not.toHaveProperty('encCreds');
    expect(body.data[0]).not.toHaveProperty('encNonce');
    expect(body.data[0]).not.toHaveProperty('dekId');
  });
});

describe('GET /:id — get config', () => {
  it('returns 404 when the config does not exist', async () => {
    mockState.result = [];
    const res = await appWithOrg('org-1').request(`/${MODEL_ID}`);
    expect(res.status).toBe(404);
  });

  it('returns the sanitized config', async () => {
    mockState.result = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        orgId: 'org-1',
        modelId: MODEL_ID,
        egressMode: 'vpn',
        healthy: false,
        encCreds: new Uint8Array([9]),
        encNonce: new Uint8Array([9]),
        dekId: 'egress-dek',
      },
    ];
    const res = await appWithOrg('org-1').request(`/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.egressMode).toBe('vpn');
    expect(body.data).not.toHaveProperty('encCreds');
  });
});

describe('PATCH /:id — update config', () => {
  it('updates non-credential fields without a plane call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockState.result = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        orgId: 'org-1',
        modelId: MODEL_ID,
        egressMode: 'http',
        healthy: true,
      },
    ];
    const res = await appWithOrg('org-1').request(`/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ egressMode: 'http', proxyAddr: '127.0.0.1:8080' }),
    });
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-encrypts creds via the plane when credential fields change', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          enc_creds: Buffer.from('newcipher').toString('base64'),
          enc_nonce: Buffer.from('n'.repeat(24)).toString('base64'),
          dek_id: 'egress-dek',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    mockState.result = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        orgId: 'org-1',
        modelId: MODEL_ID,
        egressMode: 'socks5',
        healthy: true,
      },
    ];
    const res = await appWithOrg('org-1').request(`/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proxyPassword: 'rotated' }),
    });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when the config does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })));
    mockState.result = [];
    const res = await appWithOrg('org-1').request(`/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ egressMode: 'http' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /:id — delete config', () => {
  it('deletes the config (200)', async () => {
    mockState.result = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        orgId: 'org-1',
        modelId: MODEL_ID,
        egressMode: 'direct',
        healthy: false,
      },
    ];
    const res = await appWithOrg('org-1').request(`/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
  });

  it('returns 404 when the config does not exist', async () => {
    mockState.result = [];
    const res = await appWithOrg('org-1').request(`/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });
});

describe('Plane proxy endpoints', () => {
  it('GET /plane/health proxies the plane health check', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'ok', version: '0.1.0' }), { status: 200 }),
      ),
    );
    const res = await appWithOrg('org-1').request('/plane/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.status).toBe('ok');
  });

  it('GET /plane/status proxies the live bound-egress status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ status: 'ok', count: 1, models: [{ model_id: MODEL_ID, healthy: true }] }),
          { status: 200 },
        ),
      ),
    );
    const res = await appWithOrg('org-1').request('/plane/status');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.count).toBe(1);
    expect(body.data.models[0].model_id).toBe(MODEL_ID);
  });

  it('POST /plane/bind forwards the model bind with org_id injected', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'bound', model_id: MODEL_ID, healthy: true }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await appWithOrg('org-1').request('/plane/bind', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model_id: MODEL_ID, mode: 'wireguard', wg_endpoint: 'x:51820' }),
    });
    expect(res.status).toBe(200);
    const callUrl = fetchMock.mock.calls[0][0] as string;
    expect(callUrl.endsWith('/egress/bind')).toBe(true);
    const callInit = fetchMock.mock.calls[0][1] as { body: string };
    const payload = JSON.parse(callInit.body) as { org_id: string; model_id: string };
    expect(payload.org_id).toBe('org-1');
    expect(payload.model_id).toBe(MODEL_ID);
  });

  it('POST /plane/sync asks the plane to sync configs from the DB', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'synced', bound: 2 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await appWithOrg('org-1').request('/plane/sync', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.status).toBe('synced');
    expect(body.data.bound).toBe(2);
  });

  it('returns 502 when the plane is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const res = await appWithOrg('org-1').request('/plane/status');
    expect(res.status).toBe(502);
    const body = (await res.json()) as any;
    expect(body.detail).toContain('egress plane unreachable');
  });
});
