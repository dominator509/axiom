import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, LocaleCatalog, formatNumber, type SupportedLocale } from '@axiom/core';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  linkbio: vi.fn(),
  linkbioAnalytics: vi.fn(),
  linkbioAttribution: vi.fn(),
  linkbioPostLinks: vi.fn(),
  getServerLocale: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  getSession: mocks.getSession,
  api: {
    models: {
      linkbio: mocks.linkbio,
      linkbioAnalytics: mocks.linkbioAnalytics,
      linkbioAttribution: mocks.linkbioAttribution,
      linkbioPostLinks: mocks.linkbioPostLinks,
    },
  },
}));
vi.mock('@/lib/server-locale', () => ({ getServerLocale: mocks.getServerLocale }));
vi.mock('@/components/LinkbioPanel', () => ({
  default: ({ modelId, canEdit }: { modelId: string; canEdit: boolean }) => (
    <div data-model={modelId} data-can-edit={String(canEdit)} />
  ),
}));
vi.mock('@/components/LinkbioCostManager', () => ({ default: () => <div data-testid="campaign-costs" /> }));
vi.mock('@/components/LinkbioPostLinkManager', () => ({ default: () => <div data-testid="post-attribution-links" /> }));

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
  mocks.linkbioPostLinks.mockResolvedValue({ data: { publishedPosts: [], links: [] } });
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
    data: { providers: [], totalClicks: 12345, topTargets: [{ target: 'https://example.test', count: 12345 }] },
  });
  mocks.linkbioAttribution.mockResolvedValue({
    data: {
      currency: 'USD', totalClicks: 12345, attributedConversions: 1234, unattributedConversions: 1001,
      attributedRevenueCents: 12345, conversionRate: 0.25, roi: null, roiStatus: 'unavailable',
      links: [{ id: 'short-link', slug: 'welcome', targetUrl: 'https://example.test', clicks: 12345, conversions: 1234, revenueCents: 12345, costCents: 0, roiPercent: null }],
    },
  });

  const html = await render('de');
  expect(html).toContain(catalog.t('de', 'modelSurface.linkbioTitle'));
  expect(html).toContain(catalog.t('de', 'modelSurface.clickAnalytics'));
  expect(html).toContain(catalog.t('de', 'modelSurface.fanvueAttribution'));
  expect(html).not.toContain(catalog.t('en', 'modelSurface.clickAnalytics'));
  expect(html).toContain('https://example.test');
  expect(html).toContain('welcome');
  expect(html).toContain(formatNumber(12345, 'de'));
  expect(html).toContain(formatNumber(1234, 'de'));
  expect(html).not.toContain('12345');
  expect(html).toContain('data-can-edit="true"');
});

it('mounts the per-post attribution flow only for an enabled native provider', async () => {
  mocks.linkbio.mockResolvedValue({ data: { providers: [], primary: null, nativeEnabled: true } });
  mocks.linkbioPostLinks.mockResolvedValue({ data: {
    publishedPosts: [{ id: 'post-1', platform: 'instagram', publishedAt: null, caption: 'A published post' }],
    links: [],
  } });
  const html = await render();
  expect(html).toContain('data-testid="post-attribution-links"');
});

it.each(['es', 'ja', 'it', 'pt-BR', 'de'] as SupportedLocale[])('localizes the empty provider state in %s', async (locale) => {
  const html = await render(locale);
  expect(html).toContain(catalog.t(locale, 'modelSurface.noProvider'));
  expect(html).not.toContain(catalog.t('en', 'modelSurface.noProvider'));
});
