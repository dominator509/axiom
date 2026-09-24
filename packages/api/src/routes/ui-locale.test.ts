import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockDbFactory, mockState } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ uiLocalePreference: {} }));
vi.mock('@axiom/core', async () => {
  const actual = await vi.importActual<typeof import('@axiom/core')>('@axiom/core');
  return actual;
});
vi.mock('./helpers.js', async () => {
  const actual = await vi.importActual<typeof import('./helpers.js')>('./helpers.js');
  return { ...actual, writeAudit: vi.fn().mockResolvedValue(undefined) };
});

import { uiLocaleRouter } from './ui-locale.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';

function appWithContext(orgId: string | null, role: string = 'member') {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    c.set('role', role as any);
    await next();
  });
  app.route('/', uiLocaleRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
  mockState.results = [];
  mockState.updates = [];
  mockState.insertValues = [];
  vi.clearAllMocks();
});

describe('F-89 ui locale API', () => {
  it('requires an authenticated org and user context', async () => {
    expect((await appWithContext(null).request('/ui-locale')).status).toBe(401);
  });

  it('resolves user over org over Accept-Language over English', async () => {
    mockState.result = [
      { scope: 'org', orgId: ORG_ID, userId: null, locale: 'de', updatedAt: new Date() },
      { scope: 'user', orgId: ORG_ID, userId: 'user-1', locale: 'ja', updatedAt: new Date() },
    ];
    const response = await appWithContext(ORG_ID).request('/ui-locale', { headers: { 'accept-language': 'es' } });
    expect(response.status).toBe(200);
    expect((await response.json() as any).data).toMatchObject({ locale: 'ja', source: 'user', userLocale: 'ja', orgLocale: 'de' });
  });

  it('falls back to Accept-Language and then English', async () => {
    mockState.result = [];
    const fromBrowser = await appWithContext(ORG_ID).request('/ui-locale', { headers: { 'accept-language': 'it-IT,it;q=0.9' } });
    expect((await fromBrowser.json() as any).data).toMatchObject({ locale: 'it', source: 'accept-language' });
    const defaulted = await appWithContext(ORG_ID).request('/ui-locale');
    expect((await defaulted.json() as any).data).toMatchObject({ locale: 'en', source: 'default' });
  });

  it('rejects unsupported locales before persistence', async () => {
    const response = await appWithContext(ORG_ID).request('/ui-locale', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'user', locale: 'fr' }) });
    expect(response.status).toBe(422);
    expect(mockState.insertValues).toHaveLength(0);
    expect(mockState.updates).toHaveLength(0);
  });

  it('writes a user locale and returns the persisted selection', async () => {
    mockState.results = [[], [], [], [], [{ scope: 'user', orgId: ORG_ID, userId: 'user-1', locale: 'pt-BR', updatedAt: new Date() }]];
    const response = await appWithContext(ORG_ID).request('/ui-locale', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locale: 'pt-BR' }) });
    expect(response.status).toBe(200);
    expect(mockState.insertValues[0]).toMatchObject({ scope: 'user', orgId: ORG_ID, userId: 'user-1', locale: 'pt-BR' });
    expect((await response.json() as any).data).toMatchObject({ locale: 'pt-BR', source: 'user' });
  });

  it('allows only owners to write the organization default', async () => {
    const denied = await appWithContext(ORG_ID, 'member').request('/ui-locale', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'org', locale: 'es' }) });
    expect(denied.status).toBe(403);
    mockState.results = [[], [], [], [], [{ scope: 'org', orgId: ORG_ID, userId: null, locale: 'es', updatedAt: new Date() }]];
    const allowed = await appWithContext(ORG_ID, 'owner').request('/ui-locale', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'org', locale: 'es' }) });
    expect(allowed.status).toBe(200);
    expect(mockState.insertValues[0]).toMatchObject({ scope: 'org', orgId: ORG_ID, userId: null, locale: 'es' });
  });
});
