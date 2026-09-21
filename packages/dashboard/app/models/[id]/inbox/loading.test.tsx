import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, LocaleCatalog, type SupportedLocale } from '@axiom/core';

const getServerLocale = vi.hoisted(() => vi.fn());
vi.mock('@/lib/server-locale', () => ({ getServerLocale }));
import InboxLoading from './loading';

const catalog = new LocaleCatalog(CATALOGS);
const localeFor = (locale: SupportedLocale) => ({
  locale,
  t: (key: string, values?: Record<string, string | number>) => catalog.t(locale, key, values),
  dateTime: (value: string | Date) => String(value),
});

it.each(['en', 'es', 'ja', 'it', 'pt-BR', 'de'] as SupportedLocale[])('renders localized inbox loading copy for %s', async (locale) => {
  getServerLocale.mockResolvedValue(localeFor(locale));
  const html = renderToStaticMarkup(await InboxLoading());
  expect(html).toContain(catalog.t(locale, 'modelSurface.loadingInbox'));
  expect(html).toContain(catalog.t(locale, 'modelSurface.loadingInboxDescription'));
});

