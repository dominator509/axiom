import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, LocaleCatalog, formatNumber, type SupportedLocale } from '@axiom/core';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  verify: vi.fn(),
  getServerLocale: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: { audit: { list: mocks.list, verify: mocks.verify } } }));
vi.mock('@/lib/server-locale', () => ({ getServerLocale: mocks.getServerLocale }));

import AuditPage from './page';

const catalog = new LocaleCatalog(CATALOGS);
const localeFor = (locale: SupportedLocale) => ({
  locale,
  t: (key: string, values?: Record<string, string | number>) => catalog.t(locale, key, values),
  dateTime: (value: string | Date) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
    .format(typeof value === 'string' ? new Date(value) : value),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getServerLocale.mockResolvedValue(localeFor('de'));
  mocks.list.mockResolvedValue({ data: [{ id: 'audit-1', ts: '2026-09-15T12:00:00Z', actorRef: 'operator-123', action: 'model.updated', target: 'model-123', detail: { ok: true } }] });
  mocks.verify.mockResolvedValue({ data: { rows: 12345, valid: true, fullyVerified: true, legacyRows: 0 } });
});

it('formats the audit chain entry count in the selected locale', async () => {
  const html = renderToStaticMarkup(await AuditPage());
  expect(html).toContain(catalog.t('de', 'audit.chainValid', { count: formatNumber(12345, 'de') }));
  expect(html).toContain(formatNumber(12345, 'de'));
  expect(html).not.toContain('12345 entries');
  expect(html).toContain('operator-123');
});

it('warns when a valid chain contains rows using legacy hashes', async () => {
  mocks.verify.mockResolvedValue({ data: { rows: 12, valid: true, fullyVerified: false, legacyRows: 3 } });
  const html = renderToStaticMarkup(await AuditPage());
  expect(html).toContain(catalog.t('de', 'audit.chainLegacy', { count: formatNumber(12, 'de'), legacy: formatNumber(3, 'de') }));
  expect(html).toContain('badge warn');
});
