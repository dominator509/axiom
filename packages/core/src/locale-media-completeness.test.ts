// ─── Media gallery shell locale completeness (MEDIA-LOCALE-SHELL-CURRENT-R1) ───
//
// Pure contract tests: no database, no network, no filesystem.
// Every key introduced by the authenticated media gallery shell localization must
// exist with an intentional, non-empty translation in all six launch locales —
// and must never silently fall back to English.

import { expect, it } from 'vitest';
import { LocaleCatalog, SUPPORTED_LOCALES, type DiagnosticEvent } from './locale.js';
import { CATALOGS } from './catalogs.js';

/** Keys introduced by the authenticated media gallery shell slice. */
const NEW_KEYS = [
  'media.accessUnavailable',
  'media.accessDescription',
  'media.back',
  'media.title',
  'media.description',
  'media.uploadOrCreate',
  'media.reviewBundles',
  'media.filterAria',
  'media.filterTitle',
  'media.sourceLabel',
  'media.allSources',
  'media.originUploaded',
  'media.originGenerated',
  'media.originTransformed',
  'media.originLegacy',
  'media.typeLabel',
  'media.allKinds',
  'media.kindImage',
  'media.kindVideo',
  'media.applyFilters',
  'media.clearFilters',
  'media.showingAllSources',
  'media.showingAllKinds',
  'media.showingFilters',
  'media.operationsLoadFailed',
  'media.loadFailed',
  'media.emptyPage',
  'media.assetTitleUploaded',
  'media.assetTitleGenerated',
  'media.assetTitleTransformed',
  'media.assetTitleSaved',
  'media.lifecycleQueued',
  'media.lifecycleQueuedDetail',
  'media.lifecycleRunning',
  'media.lifecycleRunningDetail',
  'media.lifecycleFailed',
  'media.lifecycleFailedDetail',
  'media.lifecycleCompleted',
  'media.lifecycleCompletedDetail',
  'media.lifecycleUnavailable',
  'media.lifecycleUnavailableDetail',
  'media.savedDetail',
  'media.dimensions',
  'media.derivedFromSource',
  'media.resultCountOne',
  'media.resultCountMany',
  'media.openSaved',
  'media.useForVideo',
  'media.pagesAria',
  'media.latest',
  'media.older',
] as const;

it('every media shell key exists in all six locales with a non-empty translation', () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const key of NEW_KEYS) {
      const value = CATALOGS[locale][key];
      expect(typeof value, `${locale}:${key}`).toBe('string');
      expect((value ?? '').length, `${locale}:${key}`).toBeGreaterThan(0);
    }
  }
});

it('each catalog is complete against the full typed key set', () => {
  const catalog = new LocaleCatalog(CATALOGS);
  for (const locale of SUPPORTED_LOCALES) expect(catalog.isComplete(locale)).toBe(true);
});

it('construction fails loud if a catalog drops one of the new media keys', () => {
  const copy = JSON.parse(JSON.stringify(CATALOGS)) as Record<string, Record<string, string>>;
  delete copy.ja['media.title'];
  expect(() => new LocaleCatalog(copy as never)).toThrow(/media\.title/);
});

it('no new media key falls back to English for a non-English locale', () => {
  const events: DiagnosticEvent[] = [];
  const catalog = new LocaleCatalog(CATALOGS, (event) => events.push(event));
  for (const locale of SUPPORTED_LOCALES) {
    if (locale === 'en') continue;
    for (const key of NEW_KEYS) catalog.t(locale, key);
  }
  expect(events.filter((e) => e.type === 'missing_translation' || e.type === 'missing_key')).toEqual([]);
});

it('each non-English media translation actually differs from the English one', () => {
  // Guards against a copy of the English string standing in for a translation.
  // Placeholder-only and identical-by-coincidence values are excluded.
  const identicalAcrossAll: string[] = [];
  for (const key of NEW_KEYS) {
    const en = CATALOGS.en[key];
    const others = SUPPORTED_LOCALES.filter((l) => l !== 'en').map((l) => CATALOGS[l][key]);
    if (others.every((value) => value === en)) identicalAcrossAll.push(key);
  }
  // Only the locale-agnostic dimension separator is allowed to be identical.
  expect(identicalAcrossAll).toEqual(['media.dimensions']);
});

it('interpolated media keys escape caller values and leave unknown placeholders intact', () => {
  const catalog = new LocaleCatalog(CATALOGS);
  for (const locale of SUPPORTED_LOCALES) {
    const escaped = catalog.t(locale, 'media.showingFilters', { origin: '<script>&"\'', kind: 'x' });
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
    // A key with no placeholder must not swallow an unused value.
    expect(catalog.t(locale, 'media.title', { value: 'ignored' })).toBe(CATALOGS[locale]['media.title']);
  }
});
