import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, CONSENT_CATALOGS, interpolate, LocaleCatalog, PLATFORM_IDS } from '@axiom/core';
import type { MobileConsentRecord, MobileConsentStatus, MobileModelProfile } from '../api/endpoints';
import type { ConsentRecordDraft } from './ConsentScreen';

vi.mock('../api/endpoints', () => ({
  getConsentRecords: vi.fn(async () => []),
  getConsentStatus: vi.fn(async (modelId: string, platform: string) => ({ modelId, platform, ok: false, missing: ['2257'] })),
  getModels: async () => ({ data: [], meta: { total: 0, limit: 100, next_cursor: null } }),
  getUiLocale: async () => ({
    locale: 'en',
    source: 'user',
    userLocale: 'en',
    orgLocale: null,
    supportedLocales: ['en', 'es', 'ja', 'it', 'pt-BR', 'de'],
    canSetOrg: false,
  }),
}));

import { getConsentRecords, getConsentStatus } from '../api/endpoints';
import ConsentScreen, { ConsentView, canManageConsent, consentDraftError, consentRecordState, loadConsentSnapshot, type ConsentViewProps } from './ConsentScreen';

const catalog = new LocaleCatalog(CATALOGS);
const model: MobileModelProfile = {
  id: 'model-1', displayName: 'D James', handle: 'd_james', avatarUrl: null, isActive: true,
};
const record: MobileConsentRecord = {
  id: 'consent-1', platform: 'instagram', docKind: '2257',
  granted: true, grantedAt: '2026-01-01T00:00:00.000Z', expiresAt: null, revokedAt: null,
  validFrom: '2026-01-01', validTo: null, hasDocument: true,
};
const blocked: MobileConsentStatus = { platform: 'instagram', ok: false, missing: ['2257'] };
const noop = () => undefined;
const draft: ConsentRecordDraft = {
  platform: 'instagram', docKind: 'model_release', subjectRef: 'synthetic-subject',
  validFrom: '2026-01-01', validTo: '', expiresAt: '',
};
const consentT = (locale: ConsentViewProps['locale'], key: keyof typeof CONSENT_CATALOGS.en) => interpolate(CONSENT_CATALOGS[locale][key]);

const baseProps: ConsentViewProps = {
  locale: 'en', canManage: true, models: [model], selectedModelId: model.id, records: [record], statuses: [blocked],
  modelsLoading: false, dataLoading: false, error: false, draft, hasSelectedDocument: true, uploadPending: false,
  uploading: false, uploadError: null, uploadMessage: null, onSelectModel: noop, onRetry: noop,
  onDraftChange: noop, onPickDocument: noop, onUpload: noop,
};

function renderView(overrides: Partial<ConsentViewProps> = {}, locale: ConsentViewProps['locale'] = 'en') {
  return renderToStaticMarkup(<ConsentView {...baseProps} {...overrides} locale={locale} />);
}

it('mounts with a real loading state while assigned models are being read', () => {
  const html = renderToStaticMarkup(<ConsentScreen user={{ id: 'user-1', email: 'operator@example.test', name: null, role: 'operator', orgId: 'org-1' }} />);
  expect(html).toContain(catalog.t('en', 'mobile.consent.loadingModels'));
});

it('exposes document upload only to consent managers and localizes the DNG form', () => {
  expect(canManageConsent('owner')).toBe(true);
  expect(canManageConsent('manager')).toBe(true);
  expect(canManageConsent('operator')).toBe(true);
  expect(canManageConsent('content_creator')).toBe(false);
  const html = renderView({}, 'de');
  expect(html).toContain(consentT('de', 'consent.addMetadata'));
  expect(html).toContain(consentT('de', 'consent.uploadDocument'));
  expect(html).toContain(catalog.t('de', 'mobile.consent.documentSelected'));
  expect(html).toContain(catalog.t('de', 'mobile.consent.privacyNote'));
  const readOnly = renderView({ canManage: false });
  expect(readOnly).not.toContain(consentT('en', 'consent.addMetadata'));
});

it('validates consent metadata before an upload can be submitted', () => {
  const document = { uri: 'file:///license.dng', name: 'license.dng', mimeType: 'application/octet-stream', size: 10 };
  expect(consentDraftError(draft, document)).toBeNull();
  expect(consentDraftError({ ...draft, validTo: '2025-12-31' }, document)).toBe('consent.invalidRange');
  expect(consentDraftError(draft, null)).toBe('consent.invalidDocument');
});

it('loads publish eligibility for every shared platform using the selected model scope', async () => {
  const recordsMock = vi.mocked(getConsentRecords);
  const statusMock = vi.mocked(getConsentStatus);
  recordsMock.mockClear();
  statusMock.mockClear();

  const snapshot = await loadConsentSnapshot(model.id);
  expect(recordsMock).toHaveBeenCalledWith(model.id);
  expect(statusMock).toHaveBeenCalledTimes(PLATFORM_IDS.length);
  expect(statusMock.mock.calls.map(([modelId, platform]) => [modelId, platform])).toEqual(
    PLATFORM_IDS.map(platform => [model.id, platform]),
  );
  expect(snapshot.statuses.map(status => status.platform)).toEqual(PLATFORM_IDS);
  expect(snapshot.statuses.every(status => !status.ok)).toBe(true);
  const html = renderView({ statuses: snapshot.statuses });
  for (const platform of PLATFORM_IDS) expect(html).toContain(platform);
});

it('shows localized server eligibility and consent metadata without private document fields', () => {
  const html = renderView({}, 'ja');
  expect(html).toContain(catalog.t('ja', 'mobile.consent.blocked'));
  expect(html).toContain(catalog.t('ja', 'mobile.consent.missing', { documents: '2257' }));
  expect(html).toContain(catalog.t('ja', 'mobile.consent.documentStored'));
  expect(html).toContain(catalog.t('ja', 'mobile.consent.privacyNote'));
  expect(html).not.toContain('subjectRef');
  expect(html).not.toContain('sha256');
  expect(html).not.toContain('ciphertext');
});

it('renders the empty model scope in the selected locale', () => {
  const html = renderView({ models: [], selectedModelId: null, records: [], statuses: [] }, 'es');
  expect(html).toContain(catalog.t('es', 'mobile.consent.noModels'));
  expect(html).not.toContain('D James');
});

it('distinguishes revoked, expired, future, documentless and current consent records', () => {
  const now = new Date('2026-09-23T12:00:00.000Z');
  expect(consentRecordState({ ...record, granted: false }, now)).toBe('revoked');
  expect(consentRecordState({ ...record, validTo: '2026-09-22' }, now)).toBe('expired');
  expect(consentRecordState({ ...record, validFrom: '2026-09-24' }, now)).toBe('notYetValid');
  expect(consentRecordState({ ...record, hasDocument: false }, now)).toBe('needsDocument');
  expect(consentRecordState(record, now)).toBe('current');
});
