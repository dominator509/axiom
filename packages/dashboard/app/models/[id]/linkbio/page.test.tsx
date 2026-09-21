import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, LocaleCatalog, type SupportedLocale } from '@axiom/core';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  linkbio: vi.fn(),
  linkbioAnalytics: vi.fn(),
  linkbioAttribution: vi.fn(),
  getServerLocale: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  getSession: mocks.getSession,
  api: {
    models: {
      linkbio: mocks.linkbio,
      linkbioAnalytics: mocks.linkbioAnalytics,
      linkbioAttribution: mocks.linkbioAttribution,
    },
  },
}));
vi.mock('@/lib/server-locale', () => ({ getServerLocale: mocks.getServerLocale }));
vi.mock('@/components/LinkbioPanel', () => ({
  default: ({ modelId, canEdit }: { modelId: string; canEdit: boolean }) => (
    <div data-model={modelId} data-can-edit={String(canEdit)} />
  ),
}));

import LinkbioPage from './page';

const catalog = new LocaleCatalog(CATALOGS);
const localeFor = (locale: SupportedLocale) => ({
  locale,
  t: (key: string, values?: Record<string, string | number>) => catalog.t(locale, key, values),
  dateTime: (value: string | Date) => String(value),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue({ user: { role: 'owner' } });
  mocks.getServerLocale.mockResolvedValue(localeFor('en'));
  mocks.linkbio.mockResolvedValue({ data: { providers: [], primary: null, nativeEnabled: false } });
  mocks.linkbioAnalytics.mockResolvedValue({ data: { providers: [], totalClicks: 0, topTargets: [] } });
  mocks.linkbioAttribution.mockResolvedValue({ data: null });
});

const render = async (locale: SupportedLocale = 'en') => {
  mocks.getServerLocale.mockResolvedValue(localeFor(locale));
  return renderToStaticMarkup(await LinkbioPage({ params: Promise.resolve({ id: 'model' }) }));
};

it('localizes linkbio, analytics and attribution copy while preserving data', async () => {
  mocks.linkbio.mockResolvedValue({
    data: {
      providers: [{ id: 'p1', kind: 'native', enabled: true, isPrimary: true }],
      primary: { id: 'p1', kind: 'native', enabled: true, isPrimary: true },
      nativeEnabled: true,
    },
  });
  mocks.linkbioAnalytics.mockResolvedValue({
    data: { providers: [], totalClicks: 12, topTargets: [{ target: 'https://example.test', count: 12 }] },
  });
  mocks.linkbioAttribution.mockResolvedValue({
    data: {
      currency: 'USD', totalClicks: 12, attributedConversions: 3, unattributedConversions: 1,
      attributedRevenueCents: 12345, conversionRate: 0.25, roi: null, roiStatus: 'unavailable',
      links: [{ slug: 'welcome', targetUrl: 'https://example.test', clicks: 12, conversions: 3, revenueCents: 12345 }],
    },
  });

  const html = await render('de');
  expect(html).toContain(catalog.t('de', 'modelSurface.linkbioTitle'));
  expect(html).toContain(catalog.t('de', 'modelSurface.clickAnalytics'));
  expect(html).toContain(catalog.t('de', 'modelSurface.fanvueAttribution'));
  expect(html).not.toContain(catalog.t('en', 'modelSurface.clickAnalytics'));
  expect(html).toContain('https://example.test');
  expect(html).toContain('welcome');
  expect(html).toContain('data-can-edit="true"');
});

it.each(['es', 'ja', 'it', 'pt-BR', 'de'] as SupportedLocale[])('localizes the empty provider state in %s', async (locale) => {
  const html = await render(locale);
  expect(html).toContain(catalog.t(locale, 'modelSurface.noProvider'));
  expect(html).not.toContain(catalog.t('en', 'modelSurface.noProvider'));
});

