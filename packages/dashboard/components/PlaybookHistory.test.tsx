import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, LocaleCatalog, SUPPORTED_LOCALES, formatDate } from '@axiom/core';
import PlaybookHistory, { validGuidelineRevision } from './PlaybookHistory';
const row = { id: 'revision-id', modelId: 'model', platform: 'x', revision: 3, optimalTimes: ['18:00'], cadencePerWeek: 4, upsellStrategy: 'Approved approach', recordedAt: '2030-01-01T00:00:00Z' };
afterEach(() => vi.restoreAllMocks());
it('accepts only matching model/platform and bounded saved values', () => {
  expect(validGuidelineRevision(row, 'model', 'x')).toBe(true);
  for (const changed of [{ modelId: 'other' }, { platform: 'instagram' }, { revision: 0 }, { cadencePerWeek: 101 }, { optimalTimes: [42] }, { recordedAt: 'bad' }])
    expect(validGuidelineRevision({ ...row, ...changed }, 'model', 'x')).toBe(false);
});
it('makes loading explicit and explains that history cannot reconstruct lost values', () => {
  const html = renderToStaticMarkup(<PlaybookHistory modelId="model" platform="x" />);
  expect(html).toContain('Load latest history');
  expect(html).toContain('Earlier discarded values cannot be recovered');
  expect(html).not.toContain('Use revision');
});

it('uses the shared history catalog keys across all launch locales', () => {
  const catalog = new LocaleCatalog(CATALOGS);
  const keys = [
    'playbook.historyAria',
    'playbook.historyTitle',
    'playbook.historyDescription',
    'playbook.historyLoading',
    'playbook.historyLoadLatest',
    'playbook.historyLoadFailed',
    'playbook.historyEmpty',
    'playbook.historyRevision',
    'playbook.historyRecorded',
    'playbook.historyCadence',
    'playbook.historyNoPostingTimes',
    'playbook.historyNoUpsellStrategy',
    'playbook.historyRestore',
    'playbook.historyLoadOlder',
  ];
  for (const locale of SUPPORTED_LOCALES) {
    for (const key of keys) expect(catalog.t(locale, key)).not.toBe('');
  }
  expect(new Set(SUPPORTED_LOCALES.map(locale => catalog.t(locale, 'playbook.historyTitle'))).size).toBe(6);
});

it('formats recorded revisions with the shared locale-aware UTC formatter', () => {
  const formatted = formatDate(new Date(row.recordedAt), 'de', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  expect(formatted).toContain('2030');
  expect(formatted).not.toContain('T00:00:00.000Z');
});
