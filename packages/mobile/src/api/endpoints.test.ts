import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearStoredCookie } from './client';
import {
  getConsentRecords,
  getConsentStatus,
  getModels,
  getPatreonData,
  getPatreonStatus,
  getSocialConnections,
  getUiLocale,
  parseMobileConsentRecord,
  parseMobileConsentStatus,
  parseMobilePatreonRecord,
  parseMobilePatreonStatus,
  parseUiLocaleSnapshot,
  patchUiLocale,
  syncPatreon,
} from './endpoints';

const snapshot = {
  locale: 'de',
  source: 'user',
  userLocale: 'de',
  orgLocale: 'es',
  supportedLocales: ['en', 'es', 'ja', 'it', 'pt-BR', 'de'],
  canSetOrg: false,
} as const;

describe('mobile F-89 locale endpoints', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    clearStoredCookie();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('validates all six supported locale choices and precedence metadata', () => {
    expect(parseUiLocaleSnapshot(snapshot)).toEqual(snapshot);
    expect(() => parseUiLocaleSnapshot({ ...snapshot, locale: 'fr' })).toThrow('unsupported ui locale');
  });

  it('loads the persisted mobile locale', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: snapshot }), { status: 200 }));
    await expect(getUiLocale()).resolves.toMatchObject({ locale: 'de', userLocale: 'de', orgLocale: 'es' });
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/v1/ui-locale');
  });

  it('persists one user selection with a reusable idempotency key', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { ...snapshot, locale: 'it', userLocale: 'it' } }), { status: 200 }));
    await patchUiLocale('it', 'user', 'mobile-locale-intent');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toBeInstanceOf(Headers);
    expect((init.headers as Headers).get('Idempotency-Key')).toBe('mobile-locale-intent');
    expect(JSON.parse(String(init.body))).toEqual({ scope: 'user', locale: 'it' });
  });
});

describe('mobile F-91 Patreon endpoints', () => {
  const fetchMock = vi.fn();
  const connection = {
    id: 'connection-1',
    modelId: 'model-1',
    platform: 'patreon',
    displayName: 'Patreon community',
    capabilities: ['read'],
    status: 'connected',
    connectedAt: 'safe-date',
  };

  beforeEach(() => {
    fetchMock.mockReset();
    clearStoredCookie();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('keeps model selection and connection parsing bounded to server data', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: [{ id: 'model-1', displayName: 'D James', handle: 'djames', isActive: true }],
      meta: { total: 1, limit: 50, next_cursor: null },
    }), { status: 200 }));
    await expect(getModels()).resolves.toMatchObject({ data: [{ id: 'model-1', displayName: 'D James' }] });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [connection], meta: { total: 1 } }), { status: 200 }));
    await expect(getSocialConnections('model-1')).resolves.toHaveLength(1);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('modelId=model-1');
  });

  it('represents disconnected, connected and forbidden-action states without secrets', () => {
    expect(() => parseMobilePatreonStatus({ connection, counts: { campaigns: 1, members: 2, posts: 3 }, sync: [], deniedActions: ['publish'] })).not.toThrow();
    expect(parseMobilePatreonStatus({ connection, counts: { campaigns: 1, members: 2, posts: 3 }, sync: [{ resource: 'members', lastError: 'provider detail must not reach mobile' }], lastWebhook: null, deniedActions: ['publish'] })).toMatchObject({
      counts: { campaigns: 1, members: 2, posts: 3 },
      sync: [{ resource: 'members', hasError: true }],
      hasWebhook: false,
      deniedActions: ['publish'],
    });
    const record = parseMobilePatreonRecord({ id: 'row-1', providerMemberId: 'provider-secret-like-value', tierTitle: 'Supporter', status: 'active', syncedAt: 'safe-date' }, 'members');
    expect(record).toMatchObject({ id: 'row-1', title: 'Supporter', detail: 'active', providerRef: 'prov…alue' });
    expect(record).not.toHaveProperty('providerMemberId');
  });

  it('loads the redacted Patreon status contract for a selected connection', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { connection, counts: { campaigns: 1, members: 2, posts: 3 }, sync: [], lastWebhook: null, deniedActions: ['publish'] } }), { status: 200 }));
    await expect(getPatreonStatus('connection-1')).resolves.toMatchObject({ counts: { campaigns: 1, members: 2, posts: 3 }, hasWebhook: false });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('connectionId=connection-1');
  });

  it('loads normalized records and retries sync with an idempotency key', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'row-1', providerPostId: 'post-12345678', title: 'Welcome', isPublic: true, syncedAt: 'safe-date' }], meta: { bounded: true, limit: 100 } }), { status: 200 }));
    await expect(getPatreonData('connection-1', 'posts')).resolves.toMatchObject([{ title: 'Welcome', isPublic: true }]);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { resource: 'posts', count: 1, nextCursor: 'cursor-2', replay: false } }), { status: 200 }));
    await expect(syncPatreon('connection-1', 'posts', 'cursor-1', 'patreon-sync-intent')).resolves.toMatchObject({ count: 1, nextCursor: 'cursor-2' });
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((init.headers as Headers).get('Idempotency-Key')).toBe('patreon-sync-intent');
    expect(JSON.parse(String(init.body))).toEqual({ resource: 'posts', cursor: 'cursor-1' });
  });

  it('rejects malformed provider records and unsupported resource states', () => {
    expect(() => parseMobilePatreonRecord({ id: 'row-1' }, 'posts')).not.toThrow();
    expect(() => parseMobilePatreonStatus({ connection: { ...connection, platform: 'instagram' }, counts: {}, sync: [] })).toThrow('expected Patreon connection');
  });
});

describe('mobile F-87 consent endpoints', () => {
  const fetchMock = vi.fn();
  const record = {
    id: 'consent-1', modelId: 'model-1', platform: 'instagram', docKind: '2257',
    granted: true, grantedAt: '2026-01-01T00:00:00.000Z', expiresAt: null, revokedAt: null,
    validFrom: '2026-01-01', validTo: null, hasDocument: true,
    subjectRef: 'private-subject-reference', sha256: 'private-digest',
    documentCiphertext: 'private-ciphertext', blobRef: 'private-blob-reference',
  };

  beforeEach(() => {
    fetchMock.mockReset();
    clearStoredCookie();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('projects only bounded consent metadata and discards subject identifiers and document material', () => {
    const parsed = parseMobileConsentRecord(record);
    expect(parsed).toMatchObject({ id: 'consent-1', docKind: '2257', hasDocument: true, validFrom: '2026-01-01' });
    expect(parsed).not.toHaveProperty('subjectRef');
    expect(parsed).not.toHaveProperty('sha256');
    expect(JSON.stringify(parsed)).not.toContain('private-');
  });

  it('rejects incomplete grant state and normalizes the publish preflight shape', () => {
    expect(() => parseMobileConsentRecord({ ...record, hasDocument: 'yes' })).toThrow('grant/document state');
    expect(parseMobileConsentStatus({ platform: 'instagram', ok: false, missing: ['2257', 'platform_consent:instagram'] }))
      .toEqual({ platform: 'instagram', ok: false, missing: ['2257', 'platform_consent:instagram'] });
    expect(() => parseMobileConsentStatus({ platform: 'instagram', ok: false, missing: [1] })).toThrow('status fields');
  });

  it('loads model-scoped records and asks the server for the authoritative platform status', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [record], meta: { total: 1 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { platform: 'reddit', ok: false, missing: ['model_release'] } }), { status: 200 }));
    await expect(getConsentRecords('model/one')).resolves.toMatchObject([{ id: 'consent-1', platform: 'instagram' }]);
    await expect(getConsentStatus('model/one', 'reddit')).resolves.toEqual({ platform: 'reddit', ok: false, missing: ['model_release'] });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/models/model%2Fone/consent-records');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/models/model%2Fone/consent-status?platform=reddit');
  });
});
