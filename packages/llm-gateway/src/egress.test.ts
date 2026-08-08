// ─── Egress-aware fetch (L2.6) — Vitest Suite ───
// resolveEgressProxy: status lookup against the egress plane, 5s cache,
// deliberate degrade-to-direct when the plane is unreachable or the model
// is unbound/unhealthy. buildEgressFetch: undici ProxyAgent dispatcher.
import { describe, it, expect, afterEach, vi } from 'vitest';

// undici's fetch export is a non-configurable ESM binding — spyOn can't
// touch it. Mock the module at import time: keep the real ProxyAgent but
// wrap fetch so tests can inspect what buildEgressFetch passes to it.
const undiciFetchMock = vi.fn();
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return {
    ...actual,
    fetch: (...args: unknown[]) => undiciFetchMock(...args),
  };
});

// The module reads EGRESS_PLANE_URL at import time — use a fresh module
// registry per test so env changes apply.
async function loadEgress(planeUrl?: string) {
  vi.resetModules();
  if (planeUrl !== undefined) {
    process.env.EGRESS_PLANE_URL = planeUrl;
  } else {
    delete process.env.EGRESS_PLANE_URL;
  }
  return import('./egress.js');
}

function statusBody(models: unknown[]): Response {
  return new Response(JSON.stringify({ models }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('resolveEgressProxy', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns null for an empty model id without contacting the plane', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { resolveEgressProxy } = await loadEgress();
    expect(await resolveEgressProxy('')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the sidecar proxy URL for a healthy bound model', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        statusBody([
          { model_id: 'gpt-4o', mode: 'wireguard', host_ip: '10.77.0.2', healthy: true },
        ]),
      ) as unknown as typeof fetch;
    const { resolveEgressProxy } = await loadEgress();
    const proxy = await resolveEgressProxy('gpt-4o');
    expect(proxy).toBe('http://10.77.0.2:8080');
  });

  it('returns null for a model that is bound but unhealthy', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        statusBody([
          { model_id: 'gpt-4o', mode: 'wireguard', host_ip: '10.77.0.2', healthy: false },
        ]),
      ) as unknown as typeof fetch;
    const { resolveEgressProxy } = await loadEgress();
    expect(await resolveEgressProxy('gpt-4o')).toBeNull();
  });

  it('returns null for a model not present in the status', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        statusBody([{ model_id: 'other-model', healthy: true, host_ip: '10.77.0.9' }]),
      ) as unknown as typeof fetch;
    const { resolveEgressProxy } = await loadEgress();
    expect(await resolveEgressProxy('gpt-4o')).toBeNull();
  });

  it('degrades to null (direct egress) when the plane is unreachable', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;
    const { resolveEgressProxy } = await loadEgress();
    expect(await resolveEgressProxy('gpt-4o')).toBeNull();
  });

  it('degrades to null when the plane returns a non-OK status', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('boom', { status: 503 })) as unknown as typeof fetch;
    const { resolveEgressProxy } = await loadEgress();
    expect(await resolveEgressProxy('gpt-4o')).toBeNull();
  });

  it('caches the result for the TTL window (one plane call for two lookups)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(statusBody([{ model_id: 'gpt-4o', host_ip: '10.77.0.2', healthy: true }]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { resolveEgressProxy } = await loadEgress();
    expect(await resolveEgressProxy('gpt-4o')).toBe('http://10.77.0.2:8080');
    expect(await resolveEgressProxy('gpt-4o')).toBe('http://10.77.0.2:8080');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-queries after clearEgressCache', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(statusBody([{ model_id: 'gpt-4o', host_ip: '10.77.0.2', healthy: true }]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { resolveEgressProxy, clearEgressCache } = await loadEgress();
    await resolveEgressProxy('gpt-4o');
    clearEgressCache();
    await resolveEgressProxy('gpt-4o');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('hits the configured EGRESS_PLANE_URL status endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(statusBody([]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { resolveEgressProxy } = await loadEgress('http://plane.example:3999');
    await resolveEgressProxy('gpt-4o');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url.startsWith('http://plane.example:3999/egress/status')).toBe(true);
  });
});

describe('buildEgressFetch', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  it('returns a fetch function that forwards with a ProxyAgent dispatcher', async () => {
    // buildEgressFetch uses undici's OWN fetch (Node's global fetch is undici
    // 7.x and rejects an 8.x dispatcher with `invalid onRequestStart method`).
    undiciFetchMock.mockResolvedValue(new Response('ok'));
    const { buildEgressFetch } = await loadEgress();
    const egressFetch = buildEgressFetch('http://10.77.0.2:8080');
    const res = await egressFetch('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer test' },
    });
    expect(await res.text()).toBe('ok');
    expect(undiciFetchMock).toHaveBeenCalledTimes(1);
    const init = undiciFetchMock.mock.calls[0][1] as { dispatcher: unknown };
    // dispatcher must be an undici ProxyAgent for the sidecar proxy URL
    expect(init.dispatcher).toBeDefined();
    expect((init.dispatcher as { constructor: { name: string } }).constructor.name).toBe(
      'ProxyAgent',
    );
    undiciFetchMock.mockClear();
  });

  it('reuses the same ProxyAgent for the same proxy URL', async () => {
    undiciFetchMock.mockResolvedValue(new Response('ok'));
    const { buildEgressFetch } = await loadEgress();
    const a = buildEgressFetch('http://10.77.0.2:8080');
    const b = buildEgressFetch('http://10.77.0.2:8080');
    await a('https://x.example/1');
    await b('https://x.example/2');
    expect(undiciFetchMock).toHaveBeenCalledTimes(2);
    const d1 = (undiciFetchMock.mock.calls[0][1] as { dispatcher: unknown }).dispatcher;
    const d2 = (undiciFetchMock.mock.calls[1][1] as { dispatcher: unknown }).dispatcher;
    expect(d1).toBe(d2);
    undiciFetchMock.mockClear();
  });
});
