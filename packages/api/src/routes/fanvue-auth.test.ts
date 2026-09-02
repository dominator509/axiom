// Fanvue OAuth route contract tests.
// The callback target is sealed into OAuth state and credentials are sent to
// egress for encryption before the org/model connection row is written.

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
  connectorForConnection: vi.fn(),
}));

process.env.FANVUE_CLIENT_ID = 'test-client-id';
process.env.FANVUE_CLIENT_SECRET = 'test-client-secret';
process.env.FANVUE_REDIRECT_URI = 'https://callback.example.test/api/v1/connectors/fanvue/callback';
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

function egressResponse(): { ok: boolean; json: () => Promise<Record<string, string>> } {
  return {
    ok: true,
    json: async () => ({
      enc_creds: Buffer.from('ciphertext').toString('base64'),
      enc_nonce: Buffer.from('nonce').toString('base64'),
      dek_id: 'test-dek',
    }),
  };
}

function installFetchMock(
  tokenData: Record<string, unknown> = {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_in: 3600,
  },
) {
  const fetchMock = vi.fn((url: string | URL, _init?: RequestInit) => {
    if (String(url).includes('/egress/encrypt')) return Promise.resolve(egressResponse());
    return Promise.resolve({ ok: true, json: async () => tokenData });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeAll(async () => {
  const { fanvueAuthRouter } = await import('./fanvue-auth.js');
  app = appWithOrg();
  app.route('/', fanvueAuthRouter);
});

beforeEach(() => {
  mockState.result = [{ orgId: ORG_ID }];
  mockState.results = [];
  vi.unstubAllGlobals();
});

describe('GET /authorize', () => {
  it('requires a model target and seals it into the OAuth state', async () => {
    const missing = await app.request('/authorize');
    expect(missing.status).toBe(400);

    const response = await app.request(`/authorize?modelId=${MODEL_ID}`);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe('https://auth.fanvue.com');
    expect(location.searchParams.get('client_id')).toBe('test-client-id');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  });
});

describe('GET /callback', () => {
  it('stores an encrypted, model-scoped connection and never writes .env', async () => {
    const authResponse = await app.request(`/authorize?modelId=${MODEL_ID}`);
    const state = new URL(authResponse.headers.get('location')!).searchParams.get('state')!;
    const fetchMock = installFetchMock({
      access_token: 'callback-access-token',
      refresh_token: 'callback-refresh-token',
      expires_in: 3600,
      user_id: 'fanvue-user-1',
    });

    mockState.result = [{ id: CONNECTION_ID, orgId: ORG_ID }];
    const response = await app.request(
      `/callback?code=authorization-code&state=${state}`,
      callbackInit(authResponse),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ success: true, connectionId: CONNECTION_ID });
    expect(JSON.stringify(body)).not.toContain('callback-access-token');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const encryptionCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/egress/encrypt'),
    );
    expect(encryptionCall).toBeDefined();
    const encryptedPayload = JSON.parse(encryptionCall![1]!.body as string) as {
      plaintext: string;
      dek_id: string;
    };
    const stored = JSON.parse(
      Buffer.from(encryptedPayload.plaintext, 'base64').toString('utf8'),
    ) as Record<string, unknown>;
    expect(stored).toMatchObject({
      accessToken: 'callback-access-token',
      refreshToken: 'callback-refresh-token',
      externalUserId: 'fanvue-user-1',
      extra: { clientId: 'test-client-id', clientSecret: 'test-client-secret' },
    });
    expect(encryptedPayload.dek_id).toBe('test-dek');
  });

  it('rejects a callback without a valid sealed state', async () => {
    const response = await app.request('/callback?code=code&state=forged');
    expect(response.status).toBe(400);
  });
});

describe('POST /refresh', () => {
  it('requires a connection id instead of deployment-wide refresh state', async () => {
    const response = await app.request('/refresh', { method: 'POST' });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { detail: string }).detail).toContain('connectionId');
  });

  it('refreshes and re-encrypts one Fanvue connection', async () => {
    const auth = {
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
      expiresAt: 1,
      extra: { clientId: 'test-client-id', clientSecret: 'test-client-secret' },
    };
    const refreshAccessToken = vi.fn(async () => {
      auth.accessToken = 'new-access-token';
      auth.refreshToken = 'new-refresh-token';
      auth.expiresAt = 1_900_000_000;
      return { accessToken: auth.accessToken, expiresAt: auth.expiresAt };
    });
    const worker = await import('@axiom/worker');
    vi.mocked(worker.connectorForConnection).mockResolvedValueOnce({
      connection: {} as never,
      connector: { auth, refreshAccessToken } as never,
    });
    mockState.result = [{ id: CONNECTION_ID, platform: 'fanvue' }];
    const fetchMock = installFetchMock();

    const response = await app.request(`/refresh?connectionId=${CONNECTION_ID}`, {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://egress.example.test/egress/encrypt',
      expect.any(Object),
    );
    expect(JSON.stringify(await response.json())).not.toContain('new-access-token');
  });
});
