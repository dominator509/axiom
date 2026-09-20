import { describe, expect, it } from 'vitest';
import { PLATFORM_AFFILIATE_CATALOGS, PLATFORM_AFFILIATE_HOLD_REASON_KEYS } from './platform-affiliate-catalog.js';
import { SUPPORTED_LOCALES } from './locale.js';

describe('platform affiliate feature catalog', () => {
  it('covers every launch locale and every persisted hold reason', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of PLATFORM_AFFILIATE_HOLD_REASON_KEYS) {
        expect(typeof PLATFORM_AFFILIATE_CATALOGS[locale][key]).toBe('string');
        expect(PLATFORM_AFFILIATE_CATALOGS[locale][key]).not.toBe('');
      }
    }
  });
});
