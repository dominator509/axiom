import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from './locale.js';
import { SCRAPE_HISTORY_CATALOGS, SCRAPE_HISTORY_MESSAGE_KEYS } from './scrape-history-catalog.js';

describe('competitor benchmark history translations', () => {
  it('provides every history label in all supported locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of SCRAPE_HISTORY_MESSAGE_KEYS) {
        expect(SCRAPE_HISTORY_CATALOGS[locale][key], `${locale}:${key}`).toEqual(expect.any(String));
        expect(SCRAPE_HISTORY_CATALOGS[locale][key]?.trim(), `${locale}:${key}`).not.toBe('');
      }
    }
  });
});
