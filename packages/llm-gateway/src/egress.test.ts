// ─── Egress-aware fetch (L2.6) — Vitest Suite ───
// resolveEgressBinding: status lookup against the egress plane, 5s cache,
// and explicit healthy direct/proxy bindings. buildEgressFetch: undici fetch.
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

describe('resolveEgressBinding', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns null for an empty model id without contacting the plane', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { resolveEgressBinding } = await loadEgress();
    expect(await resolveEgressBinding('')).toBeNull();
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
    const { resolveEgressBinding } = await loadEgress();
    const binding = await resolveEgressBinding('gpt-4o');
    expect(binding).toEqual({ kind: 'proxy', proxyUrl: 'http://10.77.0.2:8080' });
  });

  it('returns direct only for an explicitly healthy direct binding', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        statusBody([{ model_id: 'gpt-4o', mode: 'direct', healthy: true }]),
      ) as unknown as typeof fetch;
    const { resolveEgressBinding } = await loadEgress();
    expect(await resolveEgressBinding('gpt-4o')).toEqual({ kind: 'direct' });
  });

  it('returns null for a model that is bound but unhealthy', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        statusBody([
          { model_id: 'gpt-4o', mode: 'wireguard', host_ip: '10.77.0.2', healthy: false },
        ]),
      ) as unknown as typeof fetch;
    const { resolveEgressBinding } = await loadEgress();
    expect(await resolveEgressBinding('gpt-4o')).toBeNull();
  });

  it('returns null for a model not present in the status', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        statusBody([{ model_id: 'other-model', healthy: true, host_ip: '10.77.0.9' }]),
      ) as unknown as typeof fetch;
    const { resolveEgressBinding } = await loadEgress();
    expect(await resolveEgressBinding('gpt-4o')).toBeNull();
  });

  it('returns null when the plane is unreachable', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;
    const { resolveEgressBinding } = await loadEgress();
    expect(await resolveEgressBinding('gpt-4o')).toBeNull();
  });

  it('returns null when the plane returns a non-OK status', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('boom', { status: 503 })) as unknown as typeof fetch;
    const { resolveEgressBinding } = await loadEgress();
    expect(await resolveEgressBinding('gpt-4o')).toBeNull();
  });

  it('caches the result for the TTL window (one plane call for two lookups)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(statusBody([{ model_id: 'gpt-4o', host_ip: '10.77.0.2', healthy: true }]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { resolveEgressBinding } = await loadEgress();
    expect(await resolveEgressBinding('gpt-4o')).toEqual({
      kind: 'proxy',
      proxyUrl: 'http://10.77.0.2:8080',
    });
    expect(await resolveEgressBinding('gpt-4o')).toEqual({
      kind: 'proxy',
      proxyUrl: 'http://10.77.0.2:8080',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-queries after clearEgressCache', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(statusBody([{ model_id: 'gpt-4o', host_ip: '10.77.0.2', healthy: true }]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { resolveEgressBinding, clearEgressCache } = await loadEgress();
    await resolveEgressBinding('gpt-4o');
    clearEgressCache();
    await resolveEgressBinding('gpt-4o');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('hits the configured EGRESS_PLANE_URL status endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(statusBody([]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { resolveEgressBinding } = await loadEgress('http://plane.example:3999');
    await resolveEgressBinding('gpt-4o');
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
    const egressFetch = buildEgressFetch({ kind: 'proxy', proxyUrl: 'http://10.77.0.2:8080' });
    const res = await egressFetch('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer test' },
      redirect: 'error',
    });
    expect(await res.text()).toBe('ok');
    expect(undiciFetchMock).toHaveBeenCalledTimes(1);
    const init = undiciFetchMock.mock.calls[0][1] as { dispatcher: unknown; redirect?: string };
    expect(init.redirect).toBe('error');
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
    const a = buildEgressFetch({ kind: 'proxy', proxyUrl: 'http://10.77.0.2:8080' });
    const b = buildEgressFetch({ kind: 'proxy', proxyUrl: 'http://10.77.0.2:8080' });
    await a('https://x.example/1');
    await b('https://x.example/2');
    expect(undiciFetchMock).toHaveBeenCalledTimes(2);
    const d1 = (undiciFetchMock.mock.calls[0][1] as { dispatcher: unknown }).dispatcher;
    const d2 = (undiciFetchMock.mock.calls[1][1] as { dispatcher: unknown }).dispatcher;
    expect(d1).toBe(d2);
    undiciFetchMock.mockClear();
  });

  it('uses the public-address checked connector for an explicit direct binding', async () => {
    undiciFetchMock.mockResolvedValue(new Response('ok'));
    const { buildEgressFetch } = await loadEgress();
    const egressFetch = buildEgressFetch({ kind: 'direct' });
    const res = await egressFetch('https://api.example.com/direct');
    expect(await res.text()).toBe('ok');
    expect(undiciFetchMock).toHaveBeenCalledTimes(1);
    const init = undiciFetchMock.mock.calls[0][1] as { dispatcher: { constructor: { name: string } } };
    expect(init.dispatcher.constructor.name).toBe('Agent');
    undiciFetchMock.mockClear();
  });

  it('rejects private IP literals before Node can bypass the DNS lookup guard', async () => {
    const { buildEgressFetch } = await loadEgress();
    const egressFetch = buildEgressFetch({ kind: 'direct' });
    expect(() => egressFetch('http://127.0.0.1/metadata')).toThrow('non-public IP');
    expect(() => egressFetch('http://[::1]/metadata')).toThrow('non-public IP');
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when confinement is required outside the isolated model runner', async () => {
    const priorRequired = process.env.AXIOM_EGRESS_CONFINEMENT_REQUIRED;
    const priorRunner = process.env.AXIOM_EGRESS_RUNNER;
    try {
      process.env.AXIOM_EGRESS_CONFINEMENT_REQUIRED = '1';
      delete process.env.AXIOM_EGRESS_RUNNER;
      const { buildEgressFetch } = await loadEgress();
      expect(() => buildEgressFetch({ kind: 'proxy', proxyUrl: 'http://10.77.0.2:8080' }))
        .toThrow('Egress fetch requires the isolated model egress runner');
      expect(undiciFetchMock).not.toHaveBeenCalled();
    } finally {
      if (priorRequired === undefined) delete process.env.AXIOM_EGRESS_CONFINEMENT_REQUIRED;
      else process.env.AXIOM_EGRESS_CONFINEMENT_REQUIRED = priorRequired;
      if (priorRunner === undefined) delete process.env.AXIOM_EGRESS_RUNNER;
      else process.env.AXIOM_EGRESS_RUNNER = priorRunner;
    }
  });

  it('rejects a malformed confinement flag rather than disabling confinement', async () => {
    const priorRequired = process.env.AXIOM_EGRESS_CONFINEMENT_REQUIRED;
    try {
      process.env.AXIOM_EGRESS_CONFINEMENT_REQUIRED = 'true';
      const { buildEgressFetch } = await loadEgress();
      expect(() => buildEgressFetch({ kind: 'direct' }))
        .toThrow('AXIOM_EGRESS_CONFINEMENT_REQUIRED must be exactly 1 when set');
    } finally {
      if (priorRequired === undefined) delete process.env.AXIOM_EGRESS_CONFINEMENT_REQUIRED;
      else process.env.AXIOM_EGRESS_CONFINEMENT_REQUIRED = priorRequired;
    }
  });

  it('requires the runner process to prove the exact model namespace', async () => {
    const { assertEgressFetchCaller } = await loadEgress();
    const env = {
      AXIOM_EGRESS_CONFINEMENT_REQUIRED: '1',
      AXIOM_EGRESS_RUNNER: '1',
      WORKER_EGRESS_MODEL_ID: '11111111-1111-4111-8111-111111111111',
    };
    const expectedPath = '/run/netns/egress_11111111-1111-4111-8111-111111111111';
    expect(() => assertEgressFetchCaller(env, {
      platform: 'linux', stat: (path) => path === expectedPath ? { dev: 4, ino: 4026533001 } : { dev: 4, ino: 4026533001 },
    })).not.toThrow();
    expect(() => assertEgressFetchCaller(env, {
      platform: 'linux', stat: (path) => path === expectedPath ? { dev: 4, ino: 4026533001 } : { dev: 4, ino: 4026532001 },
    })).toThrow('Egress fetch caller is not running in its assigned network namespace');
  });
});

describe('public egress address policy', () => {
  it('allows public DNS answers but rejects a mixed public/private answer set', async () => {
    const { assertPublicEgressAnswers } = await loadEgress();
    expect(() => assertPublicEgressAnswers([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ])).not.toThrow();
    expect(() => assertPublicEgressAnswers([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])).toThrow('non-public');
    expect(() => assertPublicEgressAnswers([
      { address: '93.184.216.34', family: 4 },
      { address: 'fe80::1', family: 6 },
    ])).toThrow('non-public');
  });

  it.each([
    '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '192.0.2.1', '198.18.0.1', '224.0.0.1',
    '::1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002::1', '3fff::1',
  ])('rejects non-public address %s', async (address) => {
    const { isPublicEgressAddress } = await loadEgress();
    expect(isPublicEgressAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111'])('accepts public address %s', async (address) => {
    const { isPublicEgressAddress } = await loadEgress();
    expect(isPublicEgressAddress(address)).toBe(true);
  });
});
