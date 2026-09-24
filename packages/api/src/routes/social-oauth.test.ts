import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';

const {
  persistOAuthConnection,
  loadOAuthConnection,
  decryptOAuthCredentials,
  updateOAuthCredentials,
  resolveEgressBinding,
  buildEgressFetch,
  requireOrg,
  modelOrgId,
  withOrgContext,
} = vi.hoisted(() => ({
  persistOAuthConnection: vi.fn(),
  loadOAuthConnection: vi.fn(),
  decryptOAuthCredentials: vi.fn(),
  updateOAuthCredentials: vi.fn(),
  resolveEgressBinding: vi.fn(),
  buildEgressFetch: vi.fn(),
  requireOrg: vi.fn(),
  modelOrgId: vi.fn(),
  withOrgContext: vi.fn(),
}));

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';

vi.mock('./oauth-connection.js', () => ({
  persistOAuthConnection,
  loadOAuthConnection,
  decryptOAuthCredentials,
  updateOAuthCredentials,
}));
vi.mock('./helpers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./helpers.js')>();
  return { ...actual, requireOrg, modelOrgId, withOrgContext };
});
vi.mock('@axiom/llm-gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@axiom/llm-gateway')>();
  return { ...actual, resolveEgressBinding, buildEgressFetch };
});

process.env.BETTER_AUTH_URL = 'https://axiom.example.test';
process.env.BETTER_AUTH_SECRET = 'test-oauth-cookie-secret-with-enough-entropy';
process.env.TIKTOK_CLIENT_KEY = 'test-tiktok-client';
process.env.TIKTOK_CLIENT_SECRET = 'test-tiktok-secret';
process.env.X_CLIENT_ID = 'test-x-client';
process.env.X_CLIENT_SECRET = 'test-x-secret';
process.env.DISCORD_CLIENT_ID = 'test-discord-client';
process.env.DISCORD_CLIENT_SECRET = 'test-discord-secret';

let app: Hono<AppBindings>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function callbackRequest(authResponse: Response, platform: string, code = 'auth-code') {
  const location = new URL(authResponse.headers.get('location')!);
  return {
    path: `/${platform}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(location.searchParams.get('state')!)}`,
    init: { headers: { cookie: authResponse.headers.get('set-cookie')?.split(';', 1)[0] ?? '' } },
  };
}

beforeAll(async () => {
  const { socialOAuthRouter } = await import('./social-oauth.js');
  app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('orgId', ORG_ID);
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', socialOAuthRouter);
});

beforeEach(() => {
  vi.unstubAllGlobals();
  process.env.TIKTOK_CLIENT_KEY = 'test-tiktok-client';
  process.env.TIKTOK_CLIENT_SECRET = 'test-tiktok-secret';
  process.env.X_CLIENT_ID = 'test-x-client';
  process.env.X_CLIENT_SECRET = 'test-x-secret';
  process.env.DISCORD_CLIENT_ID = 'test-discord-client';
  process.env.DISCORD_CLIENT_SECRET = 'test-discord-secret';
  persistOAuthConnection.mockReset().mockResolvedValue({ id: CONNECTION_ID });
  loadOAuthConnection.mockReset().mockResolvedValue([{
    id: CONNECTION_ID,
    orgId: ORG_ID,
    modelId: MODEL_ID,
    platform: 'x',
    encToken: new Uint8Array([1]),
    encNonce: new Uint8Array([2]),
    dekId: 'test-dek',
  }]);
  decryptOAuthCredentials.mockReset().mockResolvedValue({
    accessToken: 'old-x-access', refreshToken: 'old-x-refresh', externalUserId: 'x-user',
    extra: { grantedScopes: ['users.read', 'tweet.read'], preserved: 'metadata' },
  });
  updateOAuthCredentials.mockReset().mockResolvedValue(true);
  resolveEgressBinding.mockReset().mockResolvedValue({ kind: 'proxy', proxyUrl: 'http://model-egress.invalid:8080' });
  buildEgressFetch.mockReset().mockImplementation(() => globalThis.fetch);
  requireOrg.mockReset().mockReturnValue(ORG_ID);
  modelOrgId.mockReset().mockResolvedValue(ORG_ID);
  withOrgContext.mockReset().mockImplementation(async (_orgId: string, callback: (tx: unknown) => unknown) => callback({}));
});

describe('model-scoped social OAuth', () => {
  it('uses the provider authorization contract and binds a TikTok callback to model egress and granted scopes', async () => {
    const auth = await app.request(`/tiktok/authorize?modelId=${MODEL_ID}`);
    expect(auth.status).toBe(302);
    const location = new URL(auth.headers.get('location')!);
    expect(location.origin).toBe('https://www.tiktok.com');
    expect(location.searchParams.get('client_key')).toBe('test-tiktok-client');
    expect(location.searchParams.get('scope')).toBe('user.info.basic,video.publish,video.upload,video.list');
    expect(auth.headers.get('set-cookie')).toContain('HttpOnly');

    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/v2/oauth/token/')) {
        return json({ access_token: 'tiktok-access-token', expires_in: 3600, scope: 'user.info.basic,video.publish' });
      }
      if (url.includes('/v2/user/info/')) {
        return json({ data: { user: { open_id: 'open-id-1', display_name: 'Creator' } } });
      }
      throw new Error(`Unexpected provider URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const callback = callbackRequest(auth, 'tiktok');
    const response = await app.request(callback.path, callback.init);

    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(responseBody).toMatchObject({ status: 'success', platform: 'tiktok', connectionId: CONNECTION_ID, displayName: 'Creator' });
    expect(JSON.stringify(responseBody)).not.toContain('tiktok-access-token');
    expect(resolveEgressBinding).toHaveBeenCalledWith(MODEL_ID);
    expect(persistOAuthConnection).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG_ID,
      modelId: MODEL_ID,
      platform: 'tiktok',
      credentials: expect.objectContaining({
        accessToken: 'tiktok-access-token',
        externalUserId: 'open-id-1',
        extra: expect.objectContaining({ grantedScopes: ['user.info.basic', 'video.publish'] }),
      }),
    }));
    const stored = persistOAuthConnection.mock.calls[0][0].credentials;
    expect(JSON.stringify(stored)).not.toContain('test-tiktok-secret');
  });

  it('uses PKCE for X and does not persist an ungranted publish scope', async () => {
    process.env.X_CLIENT_SECRET = '';
    const auth = await app.request(`/x/authorize?modelId=${MODEL_ID}`);
    const location = new URL(auth.headers.get('location')!);
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/2/oauth2/token')) {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get('grant_type')).toBe('authorization_code');
        expect(body.get('code_verifier')).toBeTruthy();
        return json({ access_token: 'x-access-token', expires_in: 3600, scope: 'users.read tweet.read' });
      }
      if (url.includes('/2/users/me')) return json({ data: { id: 'x-user', name: 'Creator', username: 'creator' } });
      throw new Error(`Unexpected provider URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const callback = callbackRequest(auth, 'x');
    const response = await app.request(`${callback.path}&granted_scopes=users.read%20tweet.write&scopes=users.read%20tweet.write`, callback.init);

    expect(response.status).toBe(200);
    expect(persistOAuthConnection).toHaveBeenCalledWith(expect.objectContaining({
      credentials: expect.objectContaining({
        extra: expect.objectContaining({ grantedScopes: ['users.read', 'tweet.read'] }),
      }),
    }));
    expect(persistOAuthConnection.mock.calls[0][0].credentials.extra.grantedScopes).not.toContain('tweet.write');
  });

  it('does not infer provider grants from browser-controlled callback query parameters', async () => {
    const auth = await app.request(`/x/authorize?modelId=${MODEL_ID}`);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('/2/oauth2/token')) return json({ access_token: 'x-access-token', expires_in: 3600 });
      if (String(input).includes('/2/users/me')) return json({ data: { id: 'x-user', name: 'Creator', username: 'creator' } });
      throw new Error(`Unexpected provider URL ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const callback = callbackRequest(auth, 'x');
    const response = await app.request(`${callback.path}&granted_scopes=users.read%20tweet.write&scopes=users.read%20tweet.write`, callback.init);
    expect(response.status).toBe(200);
    expect(persistOAuthConnection.mock.calls[0][0].credentials.extra.grantedScopes).toEqual([]);
  });

  it('fails closed when model egress is not healthy', async () => {
    const auth = await app.request(`/tiktok/authorize?modelId=${MODEL_ID}`);
    const callback = callbackRequest(auth, 'tiktok');
    resolveEgressBinding.mockResolvedValueOnce(null);
    const response = await app.request(callback.path, callback.init);
    expect(response.status).toBe(503);
    expect(persistOAuthConnection).not.toHaveBeenCalled();
  });

  it('stores Discord webhook credentials as a webhook URL rather than an OAuth bearer token', async () => {
    const auth = await app.request(`/discord/authorize?modelId=${MODEL_ID}`);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('/api/oauth2/token')) {
        return json({
          access_token: 'discord-short-lived-token',
          expires_in: 604800,
          scope: 'webhook.incoming',
          webhook: { id: 'webhook-1', token: 'webhook-secret', channel_id: 'channel-1', name: 'Creator' },
        });
      }
      throw new Error(`Unexpected provider URL ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const callback = callbackRequest(auth, 'discord');
    const response = await app.request(callback.path, callback.init);

    expect(response.status).toBe(200);
    expect(persistOAuthConnection).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'discord',
      credentials: expect.objectContaining({
        accessToken: '',
        externalUserId: 'channel-1',
        extra: expect.objectContaining({ webhookUrl: 'https://discord.com/api/webhooks/webhook-1/webhook-secret' }),
      }),
    }));
  });

  it('refreshes supported OAuth tokens through the model egress and persists rotated credentials encrypted', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.x.com/2/oauth2/token');
      expect(init?.method).toBe('POST');
      expect(new URLSearchParams(String(init?.body)).get('refresh_token')).toBe('old-x-refresh');
      return json({
        access_token: 'new-x-access',
        refresh_token: 'rotated-x-refresh',
        expires_in: 3600,
        scope: 'users.read tweet.read',
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await app.request(`/x/refresh?connectionId=${CONNECTION_ID}`, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'success', platform: 'x', refreshed: true });
    expect(resolveEgressBinding).toHaveBeenCalledWith(MODEL_ID);
    expect(decryptOAuthCredentials).toHaveBeenCalledWith(expect.objectContaining({ modelId: MODEL_ID, platform: 'x' }));
    expect(updateOAuthCredentials).toHaveBeenCalledWith(ORG_ID, CONNECTION_ID, expect.objectContaining({
      accessToken: 'new-x-access',
      refreshToken: 'rotated-x-refresh',
      externalUserId: 'x-user',
      extra: expect.objectContaining({ grantedScopes: ['users.read', 'tweet.read'], preserved: 'metadata' }),
    }), 'user-1');
  });

  it('does not refresh a mismatched connection or a connection without refresh credentials', async () => {
    loadOAuthConnection.mockResolvedValueOnce([{ id: CONNECTION_ID, platform: 'youtube', modelId: MODEL_ID }]);
    const mismatch = await app.request(`/x/refresh?connectionId=${CONNECTION_ID}`, { method: 'POST' });
    expect(mismatch.status).toBe(404);
    expect(decryptOAuthCredentials).not.toHaveBeenCalled();

    decryptOAuthCredentials.mockResolvedValueOnce({ accessToken: 'access-only' });
    const noRefresh = await app.request(`/x/refresh?connectionId=${CONNECTION_ID}`, { method: 'POST' });
    expect(noRefresh.status).toBe(409);
    expect(updateOAuthCredentials).not.toHaveBeenCalled();
  });
});
