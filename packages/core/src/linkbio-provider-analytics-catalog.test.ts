import { expect, it } from 'vitest';
import { MESSAGE_KEYS, SUPPORTED_LOCALES } from './locale.js';
import { CATALOGS } from './catalogs.js';
import { LINKBIO_PROVIDER_ANALYTICS_MESSAGE_KEYS } from './linkbio-provider-analytics-catalog.js';

it('registers every provider/analytics key in every launch locale', () => {
  for (const key of LINKBIO_PROVIDER_ANALYTICS_MESSAGE_KEYS) {
    expect(MESSAGE_KEYS).toContain(key);
    for (const locale of SUPPORTED_LOCALES) {
      expect(CATALOGS[locale][key], `${locale}:${key}`).toBeTruthy();
    }
  }
});

it('keeps provider and analytics copy translated with matching interpolation placeholders', () => {
  for (const locale of SUPPORTED_LOCALES) {
    if (locale === 'en') continue;
    for (const key of LINKBIO_PROVIDER_ANALYTICS_MESSAGE_KEYS) {
      expect(CATALOGS[locale][key], `${locale}:${key}`).not.toBe(CATALOGS.en[key]);
      const englishSlots = CATALOGS.en[key].match(/\{[^}]+\}/g) ?? [];
      const localeSlots = CATALOGS[locale][key].match(/\{[^}]+\}/g) ?? [];
      expect(localeSlots.sort(), `${locale}:${key} placeholders`).toEqual(englishSlots.sort());
    }
  }
});
