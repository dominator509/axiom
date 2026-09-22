import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockDbFactory, mockState } from './test-utils.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';

vi.mock('@axiom/db', () => mockDbFactory());
vi.mock('@axiom/llm-gateway', () => ({
  resolveEgressBinding: vi.fn(async () => ({ kind: 'proxy', proxyUrl: 'http://10.77.0.3:8080' })),
  buildEgressFetch: vi.fn(() => globalThis.fetch),
}));
vi.mock('@axiom/worker', () => ({
  patreonConnectorForConnection: vi.fn(),
  capabilityNames: vi.fn(),
  resolveCapabilities: vi.fn(),
}));

process.env.PATREON_CLIENT_ID = 'patreon-client';
process.env.PATREON_CLIENT_SECRET = 'patreon-secret';
process.env.BETTER_AUTH_URL = 'https://fanthynks.example';
process.env.BETTER_AUTH_SECRET = 'patreon-test-cookie-secret-012345678901';
process.env.AXIOM_ENV = 'test';
process.env.EGRESS_PLANE_URL = 'http://egress.example';

const modelConnection = {
  id: CONNECTION_ID,
  orgId: ORG_ID,
  modelId: MODEL_ID,
  platform: 'patreon',
  displayName: 'Patreon community',
  status: 'connected',
  capabilities: ['community.identity'],
  connectedAt: new Date(),
  encToken: new Uint8Array([1]),
  encNonce: new Uint8Array([2]),
  dekId: 'test-dek',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let patreonRouter: (typeof import('./patreon.js'))['patreonRouter'];

beforeEach(async () => {
  mockState.result = [{ orgId: ORG_ID }];
  mockState.results = [];
  mockState.insertValues = [];
  mockState.updates = [];
  vi.clearAllMocks();
  ({ patreonRouter } = await import('./patreon.js'));
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string | URL) => {
      const value = String(url);
      if (value.includes('/egress/encrypt')) {
        return Promise.resolve(
          jsonResponse({
            enc_creds: Buffer.from('cipher').toString('base64'),
            enc_nonce: Buffer.from('nonce').toString('base64'),
            dek_id: 'test-dek',
          }),
        );
      }
      if (value.includes('/api/oauth2/token')) {
        return Promise.resolve(
          jsonResponse({
            access_token: 'patreon-access',
            refresh_token: 'patreon-refresh',
            expires_in: 3600,
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    }),
  );
});

function app(): Hono<AppBindings> {
  const nextApp = new Hono<AppBindings>();
  nextApp.use('*', async (c, next) => {
    c.set('orgId', ORG_ID);
    c.set('userId', 'user-1');
    c.set('role', 'owner');
    await next();
  });
  nextApp.route('/', patreonRouter);
  return nextApp;
}

describe('Patreon OAuth boundary', () => {
  it('uses the v2 read/sync/event scopes and seals model target state', async () => {
    const response = await app().request(`/connectors/patreon/authorize?modelId=${MODEL_ID}`);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe('https://www.patreon.com');
    expect(location.searchParams.get('scope')).toBe(
      'identity campaigns identity.memberships campaigns.members campaigns.posts w:campaigns.webhook',
    );
    expect(location.searchParams.get('code_challenge')).toBeTruthy();
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  });

  it('exchanges the code and persists only an encrypted Patreon connection', async () => {
    mockState.results = [
      {},
      [{ orgId: ORG_ID }],
      {},
      [{ orgId: ORG_ID }],
      {},
      [{ orgId: ORG_ID }],
      [{ ...modelConnection }],
    ];
    const authorize = await app().request(`/connectors/patreon/authorize?modelId=${MODEL_ID}`);
    const cookie = authorize.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
    const state = new URL(authorize.headers.get('location')!).searchParams.get('state');
    const response = await app().request(
      `/connectors/patreon/callback?code=one-time-code&state=${encodeURIComponent(state!)}`,
      {
        headers: { Cookie: cookie },
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      platform: 'patreon',
      connectionId: CONNECTION_ID,
    });
    expect(mockState.insertValues[0]).toMatchObject({
      platform: 'patreon',
      orgId: ORG_ID,
      modelId: MODEL_ID,
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    const encryptionRequest = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/egress/encrypt'),
    );
    expect(String(encryptionRequest?.[1]?.body)).not.toContain('patreon-secret');
    expect(String(encryptionRequest?.[1]?.body)).not.toContain('patreon-access');
  });
});

describe('Patreon sync route', () => {
  it('does not report provider data when the model-scoped connection is missing', async () => {
    mockState.result = [];
    const response = await app().request('/connectors/patreon/sync?connectionId=missing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resource: 'members' }),
    });
    expect(response.status).toBe(404);
  });
});
