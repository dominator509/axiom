import { expect, it } from 'vitest';
import { MESSAGE_KEYS, SUPPORTED_LOCALES, LocaleCatalog, type DiagnosticEvent } from './locale.js';
import { CATALOGS } from './locale-catalogs.js';

/** Keys introduced by the F-89 mobile dashboard + Relay formatting slice. */
const NEW_KEYS = [
  'mobile.greeting',
  'mobile.language',
  'mobile.relayLoading',
  'mobile.relayEyebrow',
  'mobile.relayTitle',
  'mobile.relaySubtitle',
  'mobile.incidents',
  'mobile.noIncidents',
  'mobile.digestCards',
  'mobile.noDigestCards',
  'mobile.noReportMessage',
  'mobile.crashStatus',
  'mobile.storedOnly',
  'mobile.dispatchAttempted',
  'mobile.outcomeUnknown',
  'mobile.digestMeta',
];

it('every new mobile/Relay key is in the typed key set', () => {
  for (const key of NEW_KEYS) expect(MESSAGE_KEYS).toContain(key);
});

it('all six catalogs define every new key with a non-empty translation', () => {
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

it('construction fails loud if a catalog drops one of the new keys', () => {
  const copy = JSON.parse(JSON.stringify(CATALOGS)) as Record<string, Record<string, string>>;
  delete copy.de['mobile.relayTitle'];
  expect(() => new LocaleCatalog(copy as never)).toThrow(/mobile\.relayTitle/);
});

it('no new key falls back to English for a non-English locale', () => {
  const events: DiagnosticEvent[] = [];
  const catalog = new LocaleCatalog(CATALOGS, (event) => events.push(event));
  for (const locale of SUPPORTED_LOCALES) {
    if (locale === 'en') continue;
    for (const key of NEW_KEYS) catalog.t(locale, key);
  }
  expect(events.filter((e) => e.type === 'missing_translation' || e.type === 'missing_key')).toEqual([]);
});
