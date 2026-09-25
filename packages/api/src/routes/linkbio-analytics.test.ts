import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

const mocks = vi.hoisted(() => ({
  encryptOAuthCredentials: vi.fn(),
  decryptOAuthCredentials: vi.fn(),
  resolveEgressBinding: vi.fn(),
  buildEgressFetch: vi.fn(),
  fetchGa4LinkbioMetrics: vi.fn(),
}));

vi.mock('@axiom/db', () => mockDbFactory({ linkbioProvider: {} }));
vi.mock('./oauth-connection.js', () => ({
  encryptOAuthCredentials: mocks.encryptOAuthCredentials,
  decryptOAuthCredentials: mocks.decryptOAuthCredentials,
}));
vi.mock('@axiom/llm-gateway', () => ({
  resolveEgressBinding: mocks.resolveEgressBinding,
  buildEgressFetch: mocks.buildEgressFetch,
}));
vi.mock('../linkbio-integrations.js', () => ({
  LINKBIO_PROVIDER_KINDS: ['native', 'fanlynks', 'linktree', 'beacons'],
  fetchGa4LinkbioMetrics: mocks.fetchGa4LinkbioMetrics,
}));

import { linkbioAnalyticsRouter } from './linkbio-analytics.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const PROVIDER_ID = '33333333-3333-4333-8333-333333333333';

function appWithRole(role: 'owner' | 'manager' | 'operator' | 'model' = 'owner') {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('orgId', ORG_ID);
    c.set('userId', 'user-1');
    c.set('role', role);
    await next();
  });
  app.route('/', linkbioAnalyticsRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
  mockState.results = [];
  mockState.updates = [];
  mockState.conflictUpdates = [];
  mockState.insertValues = [];
  mocks.encryptOAuthCredentials.mockReset().mockResolvedValue({
    encToken: Buffer.from('ciphertext'), encNonce: Buffer.from('nonce'), dekId: 'fixture-dek',
  });
  mocks.decryptOAuthCredentials.mockReset().mockResolvedValue({
    accessToken: 'service-account-envelope',
    extra: { clientEmail: 'analytics@axiom-test.iam.gserviceaccount.com', privateKey: 'private-key-fixture' },
  });
  mocks.resolveEgressBinding.mockReset().mockResolvedValue({ modelId: MODEL_ID });
  mocks.buildEgressFetch.mockReset().mockReturnValue(vi.fn());
  mocks.fetchGa4LinkbioMetrics.mockReset().mockResolvedValue([]);
});

afterEach(() => vi.restoreAllMocks());

describe('GA4 provider credentials', () => {
  it('stores only encrypted credential bytes and returns a saved-but-unverified state', async () => {
    mockState.results = [
      [], [{ orgId: ORG_ID }], [{ id: PROVIDER_ID, config: { links: [] } }],
      [], [{ id: PROVIDER_ID }], [], [], [],
    ];
    const privateKey = `-----BEGIN PRIVATE KEY-----\n${'x'.repeat(120)}\n-----END PRIVATE KEY-----`;
    const response = await appWithRole().request(`/models/${MODEL_ID}/linkbio/linktree/analytics-connection`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId: '12345678', clientEmail: 'analytics@axiom-test.iam.gserviceaccount.com', privateKey }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: {
      kind: 'linktree', analyticsConnected: true, status: 'configured', propertyId: '12345678',
    } });
    expect(mocks.encryptOAuthCredentials).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'google-analytics-service-account',
      extra: { clientEmail: 'analytics@axiom-test.iam.gserviceaccount.com', privateKey },
    }));
    expect(mockState.updates).toContainEqual(expect.objectContaining({
      credentialsEnc: Buffer.from('ciphertext'), credentialsNonce: Buffer.from('nonce'),
      credentialsDekId: 'fixture-dek', status: 'configured',
      config: expect.objectContaining({ ga4PropertyId: '12345678' }),
    }));
    expect(JSON.stringify(mockState.updates)).not.toContain(privateKey);
  });

  it('keeps encrypted key material out of the connection readback', async () => {
    mockState.results = [[], [{ orgId: ORG_ID }], [{
      id: PROVIDER_ID, enabled: true, status: 'connected', config: { ga4PropertyId: '12345678' },
      credentialsEnc: Buffer.from('secret-private-key'), lastSyncedAt: new Date('2026-09-22T00:00:00.000Z'),
    }]];
    const response = await appWithRole().request(`/models/${MODEL_ID}/linkbio/linktree/analytics-connection`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('12345678');
    expect(body).toContain('analyticsConnected');
    expect(body).not.toContain('secret-private-key');
  });

  it('requires owner or manager to save credentials', async () => {
    const response = await appWithRole('operator').request(`/models/${MODEL_ID}/linkbio/beacons/analytics-connection`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        propertyId: '12345678', clientEmail: 'analytics@axiom-test.iam.gserviceaccount.com',
        privateKey: `-----BEGIN PRIVATE KEY-----${'x'.repeat(120)}-----END PRIVATE KEY-----`,
      }),
    });
    expect(response.status).toBe(403);
    expect(mocks.encryptOAuthCredentials).not.toHaveBeenCalled();
  });
});

describe('FanLynks first-party analytics connection', () => {
  it('stores the page token separately from GA4 credentials and never returns it', async () => {
    const apiToken = `flx_axm_${'x'.repeat(43)}`;
    mockState.results = [
      [], [{ orgId: ORG_ID }], [{ id: PROVIDER_ID, enabled: true, config: {}, profileUrl: null }],
      [], [{ id: PROVIDER_ID }], [], [], [],
    ];
    const response = await appWithRole().request(`/models/${MODEL_ID}/linkbio/fanlynks/analytics-connection`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profileUrl: 'https://links.example/creator', apiToken }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: {
      kind: 'fanlynks', fanlynksConnected: true, profileUrl: 'https://links.example/creator',
    } });
    expect(mocks.encryptOAuthCredentials).toHaveBeenCalledWith({ accessToken: apiToken });
    expect(mockState.updates).toContainEqual(expect.objectContaining({
      fanlynksTokenEnc: Buffer.from('ciphertext'), fanlynksTokenNonce: Buffer.from('nonce'),
      fanlynksTokenDekId: 'fixture-dek', profileUrl: 'https://links.example/creator', fanlynksAnalyticsStatus: 'configured',
    }));
    expect(mockState.updates).not.toContainEqual(expect.objectContaining({ credentialsEnc: Buffer.from('ciphertext') }));
    expect(JSON.stringify(mockState.updates)).not.toContain(apiToken);
  });

  it('rejects non-HTTPS profile origins and restricts token changes to owners and managers', async () => {
    const apiToken = `flx_axm_${'x'.repeat(43)}`;
    mockState.results = [[], [{ orgId: ORG_ID }], [{ id: PROVIDER_ID, config: {} }]];
    const invalidUrl = await appWithRole().request(`/models/${MODEL_ID}/linkbio/fanlynks/analytics-connection`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profileUrl: 'http://links.example/creator', apiToken }),
    });
    expect(invalidUrl.status).toBe(422);
    for (const profileUrl of [
      'https://metadata.internal/creator',
      'https://localhost/creator',
      'https://node.local/creator',
      'https://127.0.0.1/creator',
      'https://[::1]/creator',
      'https://links.example:8443/creator',
      'https://links.example@evil.example/creator',
    ]) {
      mockState.results = [[], [{ orgId: ORG_ID }], [{ id: PROVIDER_ID, config: {} }]];
      const rejected = await appWithRole().request(`/models/${MODEL_ID}/linkbio/fanlynks/analytics-connection`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profileUrl, apiToken }),
      });
      expect(rejected.status, profileUrl).toBe(422);
    }
    expect(mocks.encryptOAuthCredentials).not.toHaveBeenCalled();

    const forbidden = await appWithRole('operator').request(`/models/${MODEL_ID}/linkbio/fanlynks/analytics-connection`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profileUrl: 'https://links.example/creator', apiToken }),
    });
    expect(forbidden.status).toBe(403);
    expect(mocks.encryptOAuthCredentials).not.toHaveBeenCalled();
  });

  it('clears the FanLynks status when the page token is disconnected', async () => {
    mockState.results = [
      [],
      [{ orgId: ORG_ID }],
      [{ id: PROVIDER_ID, config: {} }],
      [{ id: PROVIDER_ID }],
    ];
    const response = await appWithRole().request(
      '/models/' + MODEL_ID + '/linkbio/fanlynks/analytics-connection?source=fanlynks',
      { method: 'DELETE' },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: {
      kind: 'fanlynks', fanlynksConnected: false, fanlynksStatus: 'disconnected',
    } });
    expect(mockState.updates).toContainEqual(expect.objectContaining({
      fanlynksTokenEnc: null, fanlynksTokenNonce: null, fanlynksTokenDekId: null,
      fanlynksAnalyticsStatus: 'disconnected', fanlynksLastSyncedAt: null,
    }));
  });

  it('reads connection metadata without disclosing encrypted token material', async () => {
    mockState.results = [[], [{ orgId: ORG_ID }], [{
      id: PROVIDER_ID, enabled: true, status: 'connected', config: {},
      fanlynksTokenEnc: Buffer.from('secret-fanlynks-token'), profileUrl: 'https://links.example/creator',
      lastSyncedAt: new Date('2026-09-22T00:00:00.000Z'),
    }]];
    const response = await appWithRole().request(`/models/${MODEL_ID}/linkbio/fanlynks/analytics-connection`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('https://links.example/creator');
    expect(body).toContain('analyticsConnected');
    expect(body).not.toContain('secret-fanlynks-token');
  });
});

describe('FanLynks first-party analytics sync', () => {
  it('requires completed historical days before calling FanLynks', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockState.results = [[], [{ orgId: ORG_ID }], [{
      id: PROVIDER_ID, enabled: true, kind: 'fanlynks', orgId: ORG_ID, modelId: MODEL_ID,
      config: {}, profileUrl: 'https://links.example/creator',
      fanlynksTokenEnc: Buffer.from('encrypted'), fanlynksTokenNonce: Buffer.from('nonce'), fanlynksTokenDekId: 'fixture-dek',
    }]];
    const response = await appWithRole().request(`/models/${MODEL_ID}/linkbio/fanlynks/analytics-sync?source=fanlynks`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startDate: today, endDate: today }),
    });
    expect(response.status).toBe(422);
    expect(mocks.resolveEgressBinding).not.toHaveBeenCalled();
  });

  it('uses model egress, imports stable daily aggregates, and reports metric coverage', async () => {
    const startDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const endDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const apiToken = `flx_axm_${'y'.repeat(43)}`;
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: {
      metricCoverage: { pageViews: true, clicks: true, uniqueVisitors: false, conversions: false },
      sources: [{ date: startDate, source: 'instagram', medium: 'social', pageViews: 9, clicks: 3, events: 12 }],
    } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    mockState.results = [
      [], [{ orgId: ORG_ID }], [{
        id: PROVIDER_ID, enabled: true, kind: 'fanlynks', orgId: ORG_ID, modelId: MODEL_ID,
        config: {}, profileUrl: 'https://links.example/creator',
        fanlynksTokenEnc: Buffer.from('encrypted'), fanlynksTokenNonce: Buffer.from('nonce'), fanlynksTokenDekId: 'fixture-dek',
      }],
      [], [], [], [], [], [],
    ];
    mocks.decryptOAuthCredentials.mockResolvedValue({ accessToken: apiToken });
    mocks.buildEgressFetch.mockReturnValue(fetcher);

    const response = await appWithRole('operator').request(`/models/${MODEL_ID}/linkbio/fanlynks/analytics-sync`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startDate, endDate }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: {
      kind: 'fanlynks', importedRows: 1, startDate, endDate,
      metricCoverage: { pageViews: true, clicks: true, uniqueVisitors: false, conversions: false },
    } });
    expect(mocks.resolveEgressBinding).toHaveBeenCalledWith(MODEL_ID);
    expect(mocks.decryptOAuthCredentials).toHaveBeenCalledWith(expect.objectContaining({
      encToken: Buffer.from('encrypted'), encNonce: Buffer.from('nonce'), dekId: 'fixture-dek',
    }));
    expect(fetcher).toHaveBeenCalledOnce();
    const [requestUrl, requestOptions] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(requestUrl.origin).toBe('https://links.example');
    expect(requestUrl.pathname).toBe('/api/integrations/axiom/analytics');
    expect(requestUrl.searchParams.get('since')).toBe(`${startDate}T00:00:00.000Z`);
    expect(requestOptions.headers).toMatchObject({ authorization: `Bearer ${apiToken}` });
    expect(requestOptions.redirect).toBe('error');
    expect(mockState.insertValues).toContainEqual(expect.objectContaining({
      orgId: ORG_ID, providerId: PROVIDER_ID, kind: 'external.metrics', source: 'fanlynks',
      utmSource: 'instagram', target: 'instagram / social', visits: 9, uniqueVisitors: 0,
      clicks: 3, conversions: 0, externalEventId: expect.stringMatching(/^fanlynks-[a-f0-9]{64}$/),
    }));
    expect(mockState.conflictUpdates).toContainEqual(expect.objectContaining({
      target: expect.any(Array), set: expect.objectContaining({ visits: 9, uniqueVisitors: 0, clicks: 3, conversions: 0 }),
    }));
  });
});

describe('GA4 analytics sync', () => {
  it('uses model egress and idempotently upserts normalized daily records', async () => {
    const startDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const endDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const ts = new Date(`${endDate}T00:00:00.000Z`);
    mockState.results = [
      [], [{ orgId: ORG_ID }], [{
        id: PROVIDER_ID, enabled: true, kind: 'linktree', orgId: ORG_ID, modelId: MODEL_ID,
        config: { ga4PropertyId: '12345678', ga4ClickEventName: 'link_click', ga4ConversionEventNames: ['purchase'] },
        credentialsEnc: Buffer.from('encrypted'), credentialsNonce: Buffer.from('nonce'), credentialsDekId: 'fixture-dek',
      }],
      [], [], [], [], [], [],
    ];
    mocks.fetchGa4LinkbioMetrics.mockResolvedValue([{
      externalEventId: `ga4:${'a'.repeat(64)}`, ts, source: 'instagram / social', target: '/creator',
      visits: 12, uniqueVisitors: 9, clicks: 4, conversions: 2,
    }]);
    const response = await appWithRole('operator').request(`/models/${MODEL_ID}/linkbio/linktree/analytics-sync`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startDate, endDate }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { kind: 'linktree', importedRows: 1, startDate, endDate } });
    expect(mocks.resolveEgressBinding).toHaveBeenCalledWith(MODEL_ID);
    expect(mocks.decryptOAuthCredentials).toHaveBeenCalledOnce();
    expect(mockState.insertValues).toContainEqual(expect.objectContaining({
      orgId: ORG_ID, providerId: PROVIDER_ID, kind: 'external.metrics',
      externalEventId: `ga4:${'a'.repeat(64)}`, visits: 12, uniqueVisitors: 9, clicks: 4, conversions: 2,
    }));
    expect(mockState.conflictUpdates).toContainEqual(expect.objectContaining({
      target: expect.any(Array), set: expect.objectContaining({ visits: 12, conversions: 2 }),
    }));
  });

  it('rejects a date range outside the bounded historical window before egress', async () => {
    const response = await appWithRole().request(`/models/${MODEL_ID}/linkbio/beacons/analytics-sync`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startDate: '2020-01-01', endDate: '2026-09-22' }),
    });
    expect(response.status).toBe(422);
    expect(mocks.resolveEgressBinding).not.toHaveBeenCalled();
  });
});
