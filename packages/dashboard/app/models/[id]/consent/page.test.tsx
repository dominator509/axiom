import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONSENT_CATALOGS } from '@axiom/core';
const state = vi.hoisted(() => ({ role: 'operator', locale: 'en', records: vi.fn() }));
vi.mock('@/lib/api', () => ({
  getSession: async () => ({ user: { role: state.role } }),
  api: {
    models: { consentRecords: state.records },
    uiLocale: { get: async () => ({ data: { locale: state.locale } }) },
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import ConsentPage from './page';
beforeEach(() => {
  state.role = 'operator';
  state.locale = 'en';
  state.records.mockReset().mockResolvedValue({
    data: [
      {
        id: 'record',
        platform: 'fanvue',
        docKind: 'model_release',
        subjectRef: 'model',
        blobRef: 'opaque',
        sha256: 'a'.repeat(64),
        validFrom: '2026-01-01',
        validTo: null,
        granted: true,
      },
    ],
  });
});
it('renders a role-aware metadata vault without document contents', async () => {
  const html = renderToStaticMarkup(
    await ConsentPage({ params: Promise.resolve({ id: 'model' }) }),
  );
  expect(html).toContain('Consent vault');
  expect(html).toContain('Save consent record');
  expect(html).toContain('Revoke record');
  expect(html).not.toContain('opaque');
  state.role = 'viewer';
  expect(
    renderToStaticMarkup(await ConsentPage({ params: Promise.resolve({ id: 'model' }) })),
  ).not.toContain('Save consent record');
});

it('renders the vault using the persisted locale', async () => {
  state.locale = 'es';
  const html = renderToStaticMarkup(
    await ConsentPage({ params: Promise.resolve({ id: 'model' }) }),
  );
  expect(html).toContain(CONSENT_CATALOGS.es['consent.title']);
  expect(html).toContain(CONSENT_CATALOGS.es['consent.granted']);
  expect(html).not.toContain(CONSENT_CATALOGS.en['consent.title']);
});
