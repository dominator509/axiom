// ─── Fanvue OAuth Routes — Vitest Suite ───
// Covers: /authorize PKCE construction, CSRF/state validation,
// token exchange, one-time state usage, and .env token persistence.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Isolated env: temp .env file + test credentials, set BEFORE module load ──
const envDir = mkdtempSync(join(tmpdir(), 'axiom-fanvue-test-'));
const envFile = join(envDir, '.env');

process.env.FANVUE_CLIENT_ID = 'test-client-id';
process.env.FANVUE_CLIENT_SECRET = 'test-client-secret';
process.env.FANVUE_REDIRECT_URI = 'https://callback.example.test/api/v1/connectors/fanvue/callback';
process.env.AXIOM_ENV_FILE = envFile;

// Router must be imported dynamically so the env above is visible at module load.
let router: any;

beforeAll(async () => {
  const mod = await import('./fanvue-auth.js');
  router = mod.fanvueAuthRouter;
});

describe('GET /authorize', () => {
  it('redirects to Fanvue auth with full PKCE parameters', async () => {
    const res = await router.request('/authorize');
    expect(res.status).toBe(302);

    const url = new URL(res.headers.get('location')!);
    expect(url.origin).toBe('https://auth.fanvue.com');
    expect(url.pathname).toBe('/oauth2/auth');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(process.env.FANVUE_REDIRECT_URI);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('scope')).toContain('openid');
    expect(url.searchParams.get('scope')).toContain('offline_access');
  });
});

describe('GET /callback — validation', () => {
  it('rejects a request with no code', async () => {
    const res = await router.request('/callback');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail).toContain('Missing authorization code');
  });

  it('rejects a request with an OAuth error param', async () => {
    const res = await router.request('/callback?error=access_denied');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail).toContain('access_denied');
  });

  it('rejects a code with a forged/invalid state (CSRF guard)', async () => {
    const res = await router.request('/callback?code=abc123&state=forged-state');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail).toContain('CSRF');
  });

  it('rejects a code with no state at all', async () => {
    const res = await router.request('/callback?code=abc123');
    expect(res.status).toBe(400);
  });
});

describe('GET /callback — token exchange + persistence', () => {
  it('exchanges the code with code_verifier and persists tokens to .env', async () => {
    // 1. Start a flow to obtain a valid state
    const authRes = await router.request('/authorize');
    const state = new URL(authRes.headers.get('location')!).searchParams.get('state')!;

    // 2. Stub Fanvue's token endpoint
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'acc-tok-1234567890',
        refresh_token: 'ref-tok-0987654321',
        expires_in: 3600,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    // 3. Hit the callback with the real state
    const res = await router.request(`/callback?code=ory_test_code&state=${state}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.hasAccessToken).toBe(true);
    expect(body.hasRefreshToken).toBe(true);

    // 4. Token endpoint was called with the PKCE code_verifier
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://auth.fanvue.com/oauth2/token');
    const form = new URLSearchParams(init.body.toString());
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('ory_test_code');
    expect(form.get('redirect_uri')).toBe(process.env.FANVUE_REDIRECT_URI);
    expect(form.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(init.headers.Authorization).toMatch(/^Basic /);

    // 5. Tokens were persisted to the env file with restrictive perms
    const env = readFileSync(envFile, 'utf8');
    expect(env).toContain('FANVUE_ACCESS_TOKEN=acc-tok-1234567890');
    expect(env).toContain('FANVUE_REFRESH_TOKEN=ref-tok-0987654321');
    expect(env).toContain('FANVUE_TOKEN_EXPIRES_AT=');
    const mode = statSync(envFile).mode & 0o777;
    expect(mode).toBe(0o600);

    vi.unstubAllGlobals();
  });

  it('does not leak the full access token in the response', async () => {
    const authRes = await router.request('/authorize');
    const state = new URL(authRes.headers.get('location')!).searchParams.get('state')!;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'super-secret-token-value', refresh_token: 'r', expires_in: 3600 }),
    }));

    const res = await router.request(`/callback?code=c&state=${state}`);
    const body = await res.json();
    expect(body.tokenPreview).toBe('super-secret...');
    expect(JSON.stringify(body)).not.toContain('super-secret-token-value');

    vi.unstubAllGlobals();
  });

  it('rejects a token endpoint failure with a clear error', async () => {
    const authRes = await router.request('/authorize');
    const state = new URL(authRes.headers.get('location')!).searchParams.get('state')!;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'invalid_grant' }),
    }));

    const res = await router.request(`/callback?code=bad&state=${state}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail).toBe('Token exchange failed');
    expect(body.token_response.error).toBe('invalid_grant');

    vi.unstubAllGlobals();
  });
});

describe('state is one-time use', () => {
  it('rejects replay of the same state after a completed exchange', async () => {
    const authRes = await router.request('/authorize');
    const state = new URL(authRes.headers.get('location')!).searchParams.get('state')!;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }),
    }));

    const first = await router.request(`/callback?code=c1&state=${state}`);
    expect(first.status).toBe(200);

    const replay = await router.request(`/callback?code=c2&state=${state}`);
    expect(replay.status).toBe(400);
    const body = await replay.json();
    expect(body.detail).toContain('CSRF');

    vi.unstubAllGlobals();
  });
});
