import { describe, expect, it } from 'vitest';
import { FANVUE_ANALYTICS_CATALOGS, FANVUE_ANALYTICS_KEYS } from './fanvue-analytics-catalog.js';
import { SUPPORTED_LOCALES } from './locale.js';

describe('Fanvue analytics feature catalog', () => {
  it('covers every launch locale and every feature key', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of FANVUE_ANALYTICS_KEYS) {
        expect(typeof FANVUE_ANALYTICS_CATALOGS[locale][key]).toBe('string');
        expect(FANVUE_ANALYTICS_CATALOGS[locale][key]).not.toBe('');
      }
    }
  });
});
