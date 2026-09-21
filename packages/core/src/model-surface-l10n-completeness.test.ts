import { expect, it } from 'vitest';
import { CATALOGS } from './catalogs.js';
import { LocaleCatalog, SUPPORTED_LOCALES } from './locale.js';
import { MODEL_SURFACE_MESSAGE_KEYS } from './model-surface-catalog.js';

it('covers every mounted model-surface key in every launch locale', () => {
  const diagnostics: Array<{ type: string; key: string; locale: string }> = [];
  const catalog = new LocaleCatalog(CATALOGS, (event) => diagnostics.push(event));

  for (const locale of SUPPORTED_LOCALES) {
    for (const key of MODEL_SURFACE_MESSAGE_KEYS) {
      const value = CATALOGS[locale][key];
      expect(value, `${locale}:${key}`).toBeTypeOf('string');
      expect(value.trim(), `${locale}:${key}`).not.toBe('');
      expect(catalog.t(locale, key), `${locale}:${key}`).not.toBe('');
      if (locale !== 'en') {
        expect(value, `${locale}:${key} must not fall back to English`).not.toBe(CATALOGS.en[key]);
      }
    }
  }

  expect(diagnostics).toEqual([]);
});

