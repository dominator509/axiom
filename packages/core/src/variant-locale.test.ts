import { expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from './locale.js';
import { VARIANT_UI_CATALOGS, VARIANT_UI_KEYS } from './variant-locale.js';

it('defines the complete variant UI catalog for every launch locale', () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const key of VARIANT_UI_KEYS) {
      expect(typeof VARIANT_UI_CATALOGS[locale][key], `${locale}.${String(key)}`).toBe('string');
      expect(VARIANT_UI_CATALOGS[locale][key].length, `${locale}.${String(key)}`).toBeGreaterThan(0);
    }
  }
});

it('does not silently reuse English for the variant UI catalog', () => {
  for (const locale of SUPPORTED_LOCALES.filter((value) => value !== 'en')) {
    const identical = VARIANT_UI_KEYS.filter((key) => VARIANT_UI_CATALOGS[locale][key] === VARIANT_UI_CATALOGS.en[key]);
    expect(identical.length, locale).toBeLessThan(VARIANT_UI_KEYS.length / 2);
  }
});

it('localizes the winner-selection action in every launch locale', () => {
  expect(Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, VARIANT_UI_CATALOGS[locale]['variant.manager.selectWinner']]))).toEqual({
    en: 'Select as winner',
    es: 'Seleccionar como ganadora',
    ja: '勝者として選択',
    it: 'Seleziona come vincitrice',
    'pt-BR': 'Selecionar como vencedora',
    de: 'Als Gewinnerin auswählen',
  });
});
