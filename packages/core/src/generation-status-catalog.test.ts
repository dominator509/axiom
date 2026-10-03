import { describe, expect, it } from 'vitest';
import { generationStatusCatalogIsComplete, GENERATION_STATUS_CATALOGS, GENERATION_STATUS_MESSAGE_KEYS } from './generation-status-catalog.js';
import { SUPPORTED_LOCALES } from './locale.js';

describe('generation status catalogs', () => {
  it.each(SUPPORTED_LOCALES)('covers every status message for %s', (locale) => {
    expect(generationStatusCatalogIsComplete(locale)).toBe(true);
    for (const key of GENERATION_STATUS_MESSAGE_KEYS) {
      expect(GENERATION_STATUS_CATALOGS[locale][key]).toEqual(expect.any(String));
      expect(GENERATION_STATUS_CATALOGS[locale][key].length).toBeGreaterThan(0);
    }
  });
});
