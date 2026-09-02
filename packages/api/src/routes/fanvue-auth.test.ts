// ─── Fanvue OAuth Routes — Vitest Suite ───
// Covers: /authorize PKCE construction, CSRF/state validation,
// token exchange, one-time state usage, and .env token persistence.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Isolated env: temp .env file + test credentials, set BEFORE module load ──
const envDir = mkdtempSync(join(tmpdir(), 'axiom-fanvue-test-'));
const envFile = join(envDir, '.env');
writeFileSync(envFile, '', { mode: 0o600 });

process.env.FANVUE_CLIENT_ID = 'test-client-id';
process.env.FANVUE_CLIENT_SECRET = 'test-client-secret';
process.env.FANVUE_REDIRECT_URI = 'https://callback.example.test/api/v1/connectors/fanvue/callback';
process.env.FANVUE_REFRESH_TOKEN = 'ory_rt_test_refresh';
process.env.AXIOM_ENV_FILE = envFile;

// Router must be imported dynamically so the env above is visible at module load.
let router: any;

function callbackInit(authorizationResponse: Response): RequestInit {
  return {
    headers: {
      Cookie: authorizationResponse.headers.get('set-cookie')?.split(';', 1)[0] ?? '',
    },
  };
}

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
    expect(res.headers.get('set-cookie')).toContain('axiom_fanvue_oauth_state=');
    expect(res.headers.get('set-cookie')).toContain('HttpOnly');
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
    const res = await router.request(
      `/callback?code=ory_test_code&state=${state}`,
      callbackInit(authRes),
    );
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
    if (process.platform !== 'win32') {
      const mode = statSync(envFile).mode & 0o777;
      expect(mode).toBe(0o600);
    }

    vi.unstubAllGlobals();
  });

  it('does not leak the full access token in the response', async () => {
    const authRes = await router.request('/authorize');
    const state = new URL(authRes.headers.get('location')!).searchParams.get('state')!;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'super-secret-token-value',
          refresh_token: 'r',
          expires_in: 3600,
        }),
      }),
    );

    const res = await router.request(`/callback?code=c&state=${state}`, callbackInit(authRes));
    const body = await res.json();
    expect(body).not.toHaveProperty('tokenPreview');
    expect(JSON.stringify(body)).not.toContain('super-secret-token-value');

    vi.unstubAllGlobals();
  });

  it('rejects a token endpoint failure with a clear error', async () => {
    const authRes = await router.request('/authorize');
    const state = new URL(authRes.headers.get('location')!).searchParams.get('state')!;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'invalid_grant' }),
      }),
    );

    const res = await router.request(`/callback?code=bad&state=${state}`, callbackInit(authRes));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail).toBe('Token exchange failed');
    expect(body).not.toHaveProperty('token_response');

    vi.unstubAllGlobals();
  });
});

describe('state cookie lifecycle', () => {
  it('clears the state cookie after a completed exchange', async () => {
    const authRes = await router.request('/authorize');
    const state = new URL(authRes.headers.get('location')!).searchParams.get('state')!;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }),
      }),
    );

    const first = await router.request(`/callback?code=c1&state=${state}`, callbackInit(authRes));
    expect(first.status).toBe(200);
    expect(first.headers.get('set-cookie')).toContain('Max-Age=0');

    const replay = await router.request(`/callback?code=c2&state=${state}`);
    expect(replay.status).toBe(400);
    const body = await replay.json();
    expect(body.detail).toContain('CSRF');

    vi.unstubAllGlobals();
  });
});

describe('POST /refresh', () => {
  /** Seed the canonical env file with a refresh token (route reads the file). */
  function seedRefreshToken(value: string): void {
    const lines = readFileSync(envFile, 'utf8').split('\n');
    const idx = lines.findIndex((l) => l.startsWith('FANVUE_REFRESH_TOKEN='));
    if (idx >= 0) lines[idx] = `FANVUE_REFRESH_TOKEN=${value}`;
    else lines.push(`FANVUE_REFRESH_TOKEN=${value}`);
    writeFileSync(envFile, lines.join('\n'), { mode: 0o600 });
  }

  it('exchanges the stored refresh token with client_secret_basic and persists', async () => {
    seedRefreshToken('ory_rt_test_refresh');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'fresh-token-abc123',
          refresh_token: 'new-rt',
          expires_in: 3600,
        }),
      }),
    );

    const res = await router.request('/refresh', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body).not.toHaveProperty('tokenPreview');
    expect(JSON.stringify(body)).not.toContain('fresh-token-abc123');

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://auth.fanvue.com/oauth2/token');
    const form = new URLSearchParams(init.body as string);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('ory_rt_test_refresh');
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);

    // Rotated tokens persisted to the env file (rotation-safe).
    const env = readFileSync(envFile, 'utf8');
    expect(env).toContain('FANVUE_ACCESS_TOKEN=fresh-token-abc123');
    expect(env).toContain('FANVUE_REFRESH_TOKEN=new-rt');

    vi.unstubAllGlobals();
  });

  it('returns 400 when the refresh grant fails', async () => {
    seedRefreshToken('ory_rt_test_refresh');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'invalid_grant', error_description: 'Refresh token revoked' }),
      }),
    );

    const res = await router.request('/refresh', { method: 'POST' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail).toBe('Token refresh failed');
    expect(body).not.toHaveProperty('token_response');

    vi.unstubAllGlobals();
  });

  it('rejects when no refresh token is stored in the env file', async () => {
    // Ensure the file has NO refresh token for this test.
    const before = readFileSync(envFile, 'utf8');
    const cleaned = before
      .split('\n')
      .filter((l) => !l.startsWith('FANVUE_REFRESH_TOKEN='))
      .join('\n');
    writeFileSync(envFile, cleaned, { mode: 0o600 });
    try {
      const res = await router.request('/refresh', { method: 'POST' });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.detail).toContain('No refresh token stored');
    } finally {
      writeFileSync(envFile, before, { mode: 0o600 });
    }
  });
});
