import { describe, expect, it } from 'vitest';
import { PROVIDER_CACHE_CONTROL_CATALOGS } from './provider-cache-control-catalog.js';
import { SUPPORTED_LOCALES } from './locale.js';

describe('provider cache-control catalog', () => {
  it('covers every launch locale with the same complete key set', () => {
    const locales = SUPPORTED_LOCALES.map(locale => PROVIDER_CACHE_CONTROL_CATALOGS[locale]);
    const keys = Object.keys(locales[0] ?? {}).sort();
    expect(keys.length).toBeGreaterThan(10);
    for (const catalog of locales) expect(Object.keys(catalog).sort()).toEqual(keys);
  });
});
