import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockDbFactory, mockState } from './test-utils.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';

vi.mock('@axiom/db', () => mockDbFactory());
vi.mock('@axiom/llm-gateway', async importOriginal => {
  const actual = await importOriginal<typeof import('@axiom/llm-gateway')>();
  return { ...actual, resolveEgressBinding: vi.fn(async () => ({ kind: 'proxy', proxyUrl: 'http://10.240.1.1:8080' })), buildEgressFetch: vi.fn(() => globalThis.fetch) };
});
vi.mock('@axiom/worker', () => ({ capabilityNames: vi.fn(() => ['publish', 'read.insights']), resolveCapabilities: vi.fn(() => ({ publish: true })) }));

process.env.SNAPCHAT_CLIENT_ID = 'snap-client';
process.env.SNAPCHAT_CLIENT_SECRET = 'snap-secret';
process.env.BETTER_AUTH_URL = 'https://axiom.example.test';
process.env.BETTER_AUTH_SECRET = 'test-oauth-cookie-secret';
process.env.EGRESS_PLANE_URL = 'http://egress.example.test';
process.env.EGRESS_DEK_ID = 'test-dek';

let app: Hono<AppBindings>;
function makeApp() {
  const instance = new Hono<AppBindings>();
  instance.use('*', async (c, next) => { c.set('orgId', ORG_ID); c.set('userId', 'user-1'); await next(); });
  return instance;
}
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function callbackInit(response: Response): RequestInit {
  return { headers: { Cookie: response.headers.get('set-cookie')?.split(';', 1)[0] ?? '' } };
}

beforeAll(async () => {
  const { snapchatAuthRouter } = await import('./snapchat-auth.js');
  app = makeApp();
  app.route('/', snapchatAuthRouter);
});
beforeEach(() => {
  mockState.result = [{ orgId: ORG_ID }];
  mockState.results = [];
  mockState.insertValues = [];
  vi.unstubAllGlobals();
});

describe('Snapchat OAuth onboarding', () => {
  it('binds a sealed state to the model and requests only the documented profile scope', async () => {
    const response = await app.request(`/authorize?modelId=${MODEL_ID}`);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe('https://accounts.snapchat.com');
    expect(location.pathname).toBe('/login/oauth2/authorize');
    expect(location.searchParams.get('client_id')).toBe('snap-client');
    expect(location.searchParams.get('redirect_uri')).toBe('https://axiom.example.test/api/v1/connectors/snapchat/callback');
    expect(location.searchParams.get('scope')).toBe('snapchat-profile-api');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  });

  it('exchanges the code, verifies my_profile through model egress, then stores encrypted credentials', async () => {
    const authorize = await app.request(`/authorize?modelId=${MODEL_ID}`);
    const state = new URL(authorize.headers.get('location')!).searchParams.get('state')!;
    mockState.results = [[], [{ orgId: ORG_ID }], [], [{ orgId: ORG_ID }], [{ id: CONNECTION_ID, orgId: ORG_ID }]];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const value = String(url);
      if (value.includes('/egress/encrypt')) return jsonResponse({ enc_creds: Buffer.from('ciphertext').toString('base64'), enc_nonce: Buffer.from('nonce').toString('base64'), dek_id: 'test-dek' });
      if (value.endsWith('/login/oauth2/access_token')) return jsonResponse({ access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600, scope: 'snapchat-profile-api' });
      if (value.endsWith('/public_profiles/my_profile')) return jsonResponse({ request_status: 'SUCCESS', public_profile: { id: 'snap-profile-1', display_name: 'Creator', snap_user_name: 'creator' } });
      throw new Error(`unexpected URL ${value} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.request(`/callback?code=one-time-code&state=${encodeURIComponent(state)}`, callbackInit(authorize));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ status: 'success', platform: 'snapchat', connectionId: CONNECTION_ID, profile: { id: 'snap-profile-1', displayName: 'Creator' } });
    expect(JSON.stringify(result)).not.toContain('access-secret');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
      'https://accounts.snapchat.com/login/oauth2/access_token',
      'https://businessapi.snapchat.com/v1/public_profiles/my_profile',
      'http://egress.example.test/egress/encrypt',
    ]);
    const encryptCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/egress/encrypt'));
    const payload = JSON.parse(encryptCall?.[1]?.body as string) as { plaintext: string };
    const credentials = JSON.parse(Buffer.from(payload.plaintext, 'base64').toString('utf8')) as Record<string, unknown>;
    expect(credentials).toMatchObject({ accessToken: 'access-secret', refreshToken: 'refresh-secret', externalUserId: 'creator', extra: { grantedScopes: ['snapchat-profile-api'], snapchatProfileId: 'snap-profile-1', snapchatClientId: 'snap-client', snapchatClientSecret: 'snap-secret' } });
  });

  it('does not create a connection when Snapchat does not verify an authorized profile', async () => {
    const authorize = await app.request(`/authorize?modelId=${MODEL_ID}`);
    const state = new URL(authorize.headers.get('location')!).searchParams.get('state')!;
    const fetchMock = vi.fn(async (url: string | URL) => String(url).endsWith('/access_token')
      ? jsonResponse({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'snapchat-profile-api' })
      : jsonResponse({ request_status: 'ERROR' }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.request(`/callback?code=code&state=${state}`, callbackInit(authorize));
    expect(response.status).toBe(502);
    expect(mockState.insertValues).toEqual([]);
  });

  it('creates a no-token manual-assist connection with server-derived capabilities', async () => {
    mockState.results = [[], [{ orgId: ORG_ID }], [], [{ orgId: ORG_ID }], [], [{ orgId: ORG_ID }], [{ id: CONNECTION_ID, orgId: ORG_ID }]];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ enc_creds: Buffer.from('encrypted').toString('base64'), enc_nonce: Buffer.from('nonce').toString('base64'), dek_id: 'test-dek' }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.request('/manual', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, username: 'creator.name' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'success', platform: 'snapchat', mode: 'manual-assist', connectionId: CONNECTION_ID });
    const encryptCall = fetchMock.mock.calls[0];
    const payload = JSON.parse(encryptCall?.[1]?.body as string) as { plaintext: string };
    expect(JSON.parse(Buffer.from(payload.plaintext, 'base64').toString('utf8'))).toMatchObject({ accessToken: '', externalUserId: 'creator.name', extra: { snapchatManualAssist: true, snapchatProfileUrl: 'https://www.snapchat.com/add/creator.name' } });
    expect(mockState.insertValues).toContainEqual(expect.objectContaining({ platform: 'snapchat', capabilities: ['publish', 'publish.manual_assist', 'publish.image', 'publish.video', 'publish.story'] }));
  });

  it('refreshes an OAuth connection through model egress and re-encrypts the rotated token', async () => {
    const connection = {
      id: CONNECTION_ID,
      orgId: ORG_ID,
      modelId: MODEL_ID,
      platform: 'snapchat',
      encToken: new Uint8Array([1]),
      encNonce: new Uint8Array([2]),
      dekId: 'test-dek',
    };
    mockState.result = [];
    mockState.results = [
      [], [connection],
      [], [{ orgId: ORG_ID }],
      [], [{ id: CONNECTION_ID, platform: 'snapchat' }],
      [], [],
    ];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const value = String(url);
      if (value.includes('/egress/decrypt')) {
        return jsonResponse({ plaintext: Buffer.from(JSON.stringify({
          accessToken: 'old-access',
          refreshToken: 'old-refresh',
          extra: { grantedScopes: ['snapchat-profile-api'] },
        })).toString('base64') });
      }
      if (value.endsWith('/login/oauth2/access_token')) {
        expect(init?.method).toBe('POST');
        expect(String(init?.body)).toContain('grant_type=refresh_token');
        expect(String(init?.body)).toContain('refresh_token=old-refresh');
        return jsonResponse({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, scope: 'snapchat-profile-api' });
      }
      if (value.includes('/egress/encrypt')) return jsonResponse({ enc_creds: 'Y2lwaGVy', enc_nonce: 'bm9uY2U=', dek_id: 'test-dek' });
      throw new Error(`unexpected URL ${value}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await app.request(`/refresh?connectionId=${CONNECTION_ID}`, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'success', platform: 'snapchat', refreshed: true });
    const encryptCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/egress/encrypt'));
    const payload = JSON.parse(Buffer.from(String((encryptCall?.[1] as RequestInit)?.body).match(/\"plaintext\":\"([^\"]+)\"/)?.[1] ?? '', 'base64').toString('utf8')) as Record<string, unknown>;
    expect(payload).toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh', extra: { grantedScopes: ['snapchat-profile-api'] } });
  });

  it('rejects unsafe usernames and OAuth callbacks with invalid state', async () => {
    const unsafe = await app.request('/manual', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modelId: MODEL_ID, username: 'https://attacker.test' }) });
    expect(unsafe.status).toBe(400);
    const invalid = await app.request('/callback?code=code&state=wrong');
    expect(invalid.status).toBe(400);
  });
});
