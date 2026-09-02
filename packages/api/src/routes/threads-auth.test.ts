// Threads OAuth route contract tests.
// The callback persists the provider token as an encrypted model connection,
// including the Threads user id needed by publish and metrics.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockDbFactory, mockState } from './test-utils.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';

vi.mock('@axiom/db', () => mockDbFactory());
vi.mock('@axiom/worker', () => ({
  capabilityNames: vi.fn(() => ['publish', 'read.insights']),
  resolveCapabilities: vi.fn(() => ({ publish: true })),
}));

process.env.THREADS_CLIENT_ID = 'test-threads-client';
process.env.THREADS_CLIENT_SECRET = 'test-threads-secret';
process.env.BETTER_AUTH_URL = 'https://axiom.example.test';
process.env.BETTER_AUTH_SECRET = 'test-oauth-cookie-secret';
process.env.EGRESS_PLANE_URL = 'http://egress.example.test';
process.env.EGRESS_DEK_ID = 'test-dek';

let app: Hono<AppBindings>;

function appWithOrg(): Hono<AppBindings> {
  const nextApp = new Hono<AppBindings>();
  nextApp.use('*', async (c, next) => {
    c.set('orgId', ORG_ID);
    c.set('userId', 'user-1');
    await next();
  });
  return nextApp;
}

function callbackInit(response: Response): RequestInit {
  return {
    headers: { Cookie: response.headers.get('set-cookie')?.split(';', 1)[0] ?? '' },
  };
}

function installFetchMock(options: { longLivedOk?: boolean } = {}) {
  const fetchMock = vi.fn((url: string | URL, _init?: RequestInit) => {
    const value = String(url);
    if (value.includes('/egress/encrypt')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          enc_creds: Buffer.from('ciphertext').toString('base64'),
          enc_nonce: Buffer.from('nonce').toString('base64'),
          dek_id: 'test-dek',
        }),
      });
    }
    if (value.endsWith('/oauth/access_token')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          access_token: 'short-lived-token',
          user_id: 'threads-user-1',
          expires_in: 3600,
        }),
      });
    }
    return Promise.resolve({
      ok: options.longLivedOk !== false,
      json: async () => ({ access_token: 'long-lived-token', expires_in: 5_184_000 }),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeAll(async () => {
  const { threadsAuthRouter } = await import('./threads-auth.js');
  app = appWithOrg();
  app.route('/', threadsAuthRouter);
});

beforeEach(() => {
  mockState.result = [{ orgId: ORG_ID }];
  mockState.results = [];
  vi.unstubAllGlobals();
});

describe('GET /authorize', () => {
  it('requires a model target and binds it into sealed OAuth state', async () => {
    const missing = await app.request('/authorize');
    expect(missing.status).toBe(400);

    const response = await app.request(`/authorize?modelId=${MODEL_ID}`);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe('https://threads.net');
    expect(location.searchParams.get('client_id')).toBe('test-threads-client');
    expect(location.searchParams.get('scope')).toBe('threads_basic,threads_publish');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  });
});

describe('GET /callback', () => {
  it('stores the long-lived token and Threads user id in an encrypted connection', async () => {
    const authResponse = await app.request(`/authorize?modelId=${MODEL_ID}`);
    const state = new URL(authResponse.headers.get('location')!).searchParams.get('state')!;
    const fetchMock = installFetchMock();
    mockState.result = [{ id: CONNECTION_ID, orgId: ORG_ID }];

    const response = await app.request(
      `/callback?code=threads-code&state=${state}`,
      callbackInit(authResponse),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      status: 'success',
      platform: 'threads',
      connectionId: CONNECTION_ID,
      userThreadsId: 'threads-user-1',
    });
    expect(JSON.stringify(body)).not.toContain('long-lived-token');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const encryptionCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/egress/encrypt'),
    );
    const payload = JSON.parse(encryptionCall![1]!.body as string) as { plaintext: string };
    const stored = JSON.parse(Buffer.from(payload.plaintext, 'base64').toString('utf8')) as Record<
      string,
      unknown
    >;
    expect(stored).toMatchObject({
      accessToken: 'long-lived-token',
      externalUserId: 'threads-user-1',
    });
    expect(stored.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('falls back to the short-lived token when long-lived exchange fails', async () => {
    const authResponse = await app.request(`/authorize?modelId=${MODEL_ID}`);
    const state = new URL(authResponse.headers.get('location')!).searchParams.get('state')!;
    const fetchMock = installFetchMock({ longLivedOk: false });
    mockState.result = [{ id: CONNECTION_ID, orgId: ORG_ID }];

    const response = await app.request(
      `/callback?code=threads-code&state=${state}`,
      callbackInit(authResponse),
    );

    expect(response.status).toBe(200);
    const encryptionCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/egress/encrypt'),
    );
    const payload = JSON.parse(encryptionCall![1]!.body as string) as { plaintext: string };
    const stored = JSON.parse(Buffer.from(payload.plaintext, 'base64').toString('utf8')) as Record<
      string,
      unknown
    >;
    expect(stored.accessToken).toBe('short-lived-token');
  });

  it('rejects a callback without a sealed state target', async () => {
    const response = await app.request('/callback?code=threads-code&state=forged');
    expect(response.status).toBe(400);
  });
});

describe('webhooks', () => {
  it('acknowledges uninstall notifications without exposing credentials', async () => {
    const response = await app.request('/uninstall', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: 'threads-user-7' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'acknowledged', user_id: 'threads-user-7' });
  });

  it('returns the Meta deletion callback status URL', async () => {
    const response = await app.request('/delete?confirmation_code=delete-123');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      confirmation_code: 'delete-123',
      url: expect.stringContaining('delete-123'),
    });
  });
});
