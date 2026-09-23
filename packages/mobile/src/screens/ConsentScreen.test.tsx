import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, LocaleCatalog } from '@axiom/core';
import type { MobileConsentRecord, MobileConsentStatus, MobileModelProfile } from '../api/endpoints';

vi.mock('../api/endpoints', () => ({
  getConsentRecords: async () => [],
  getConsentStatus: async (modelId: string, platform: string) => ({ modelId, platform, ok: false, missing: ['2257'] }),
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

import ConsentScreen, { ConsentView, consentRecordState, type ConsentViewProps } from './ConsentScreen';

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

const baseProps: ConsentViewProps = {
  locale: 'en', models: [model], selectedModelId: model.id, records: [record], statuses: [blocked],
  modelsLoading: false, dataLoading: false, error: false, onSelectModel: noop, onRetry: noop,
};

function renderView(overrides: Partial<ConsentViewProps> = {}, locale: ConsentViewProps['locale'] = 'en') {
  return renderToStaticMarkup(<ConsentView {...baseProps} {...overrides} locale={locale} />);
}

it('mounts with a real loading state while assigned models are being read', () => {
  const html = renderToStaticMarkup(<ConsentScreen />);
  expect(html).toContain(catalog.t('en', 'mobile.consent.loadingModels'));
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
