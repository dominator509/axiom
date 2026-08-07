// ─── Threads OAuth & Webhook Routes — Vitest Suite ───
// Covers: /authorize redirect, /callback token exchange (short + long-lived),
// failure paths, /delete GDPR callback, /uninstall webhook, /delete/status,
// and the unconfigured-credentials path.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

const REDIRECT_URI = 'https://axiom.fanlynks.com/api/v1/auth/threads/callback';

// Env is read at module load — set it BEFORE the dynamic import.
process.env.THREADS_CLIENT_ID = 'test-threads-client-id';
process.env.THREADS_CLIENT_SECRET = 'test-threads-client-secret';

let router: any;

beforeAll(async () => {
  const mod = await import('./threads-auth.js');
  router = mod.threadsAuthRouter;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /authorize', () => {
  it('redirects to Meta Threads OAuth with app params', async () => {
    const res = await router.request('/authorize');
    expect(res.status).toBe(302);

    const url = new URL(res.headers.get('location')!);
    expect(url.origin).toBe('https://threads.net');
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('test-threads-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('scope')).toBe('threads_basic,threads_publish');
    expect(url.searchParams.get('response_type')).toBe('code');
  });
});

describe('GET /callback — validation', () => {
  it('rejects a missing authorization code', async () => {
    const res = await router.request('/callback');
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.detail).toBe('Missing authorization code');
  });

  it('reports OAuth error params from Meta', async () => {
    const res = await router.request('/callback?error=access_denied&error_description=user+said+no');
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.detail).toContain('OAuth error: access_denied');
    expect(body.detail).toContain('user said no');
  });

  it('handles an OAuth error without a description', async () => {
    const res = await router.request('/callback?error=access_denied');
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.detail).toBe('OAuth error: access_denied — ');
  });
});

describe('GET /callback — token exchange', () => {
  it('exchanges the code for a short-lived token and upgrades to long-lived', async () => {
    const fetchMock = vi.fn()
      // 1st call: short-lived token exchange
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'short-lived-token', user_id: 'threads-user-42', token_type: 'bearer' }),
      })
      // 2nd call: long-lived exchange
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'long-lived-token-abc', expires_in: 5184000 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const res = await router.request('/callback?code=meta_auth_code');
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.status).toBe('success');
    expect(body.platform).toBe('threads');
    expect(body.userThreadsId).toBe('threads-user-42');
    expect(body.tokenPreview).toBe('long-lived-t...');

    // Verify both exchange requests
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe('https://graph.threads.net/oauth/access_token');
    expect(tokenInit.method).toBe('POST');
    expect(tokenInit.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(tokenInit.body.toString());
    expect(form.get('client_id')).toBe('test-threads-client-id');
    expect(form.get('client_secret')).toBe('test-threads-client-secret');
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(form.get('code')).toBe('meta_auth_code');

    const [longUrl] = fetchMock.mock.calls[1];
    expect(longUrl).toContain('https://graph.threads.net/access_token');
    expect(longUrl).toContain('grant_type=th_exchange_token');
    expect(longUrl).toContain('client_secret=test-threads-client-secret');
    expect(longUrl).toContain('access_token=short-lived-token');
  });

  it('falls back to the short-lived token when the long-lived exchange fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'short-token', user_id: 'u1' }),
      })
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'bad request' }));

    const res = await router.request('/callback?code=c1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe('success');
    expect(body.tokenPreview).toBe('short-token...');
  });

  it('returns 502 when the short-lived token exchange fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":{"message":"Invalid OAuth 2.0 Access Token"}}',
    }));

    const res = await router.request('/callback?code=bad-code');
    expect(res.status).toBe(502);
    const body = (await res.json()) as any;
    expect(body.detail).toContain('Token exchange failed: HTTP 401');
    expect(body.detail).toContain('Invalid OAuth 2.0 Access Token');
  });

  it('returns 500 when the token endpoint throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const res = await router.request('/callback?code=c2');
    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.detail).toBe('Threads OAuth failed: network down');
  });
});

describe('GET /delete — GDPR data-deletion callback', () => {
  it('echoes the confirmation code with a status URL', async () => {
    const res = await router.request('/delete?confirmation_code=gdpr-123');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.confirmation_code).toBe('gdpr-123');
    expect(body.url).toBe('https://axiom.fanlynks.com/api/v1/auth/threads/delete/status?id=gdpr-123');
  });

  it('rejects a missing confirmation_code', async () => {
    const res = await router.request('/delete');
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.detail).toBe('Missing confirmation_code');
  });
});

describe('POST /uninstall — app uninstall webhook', () => {
  it('acknowledges with the uninstalling user id', async () => {
    const res = await router.request('/uninstall', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: 'threads-user-7' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual({ status: 'acknowledged', user_id: 'threads-user-7' });
  });

  it('defaults to unknown user id for an empty payload', async () => {
    const res = await router.request('/uninstall', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual({ status: 'acknowledged', user_id: 'unknown' });
  });

  it('tolerates a malformed JSON payload', async () => {
    const res = await router.request('/uninstall', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual({ status: 'acknowledged', user_id: 'unknown' });
  });
});

describe('GET /delete/status — deletion progress', () => {
  it('reports pending status for the given id', async () => {
    const res = await router.request('/delete/status?id=gdpr-123');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.id).toBe('gdpr-123');
    expect(body.status).toBe('pending');
  });

  it('reports pending status even without an id', async () => {
    const res = await router.request('/delete/status');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.id).toBeUndefined();
    expect(body.status).toBe('pending');
  });
});

describe('unconfigured credentials', () => {
  it('rejects /authorize when no client id is configured', async () => {
    vi.resetModules();
    delete process.env.THREADS_CLIENT_ID;
    delete process.env.THREADS_CLIENT_SECRET;
    const mod = await import('./threads-auth.js');
    const unconfigured = mod.threadsAuthRouter;

    const res = await unconfigured.request('/authorize');
    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.detail).toBe('Threads client ID not configured');
  });

  it('rejects /callback when client credentials are missing', async () => {
    const mod = await import('./threads-auth.js');
    const unconfigured = mod.threadsAuthRouter;

    const res = await unconfigured.request('/callback?code=abc');
    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.detail).toBe('Threads client credentials not configured');
  });
});
