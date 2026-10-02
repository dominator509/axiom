import { describe, expect, it } from 'vitest';
import { CATALOGS, DEFAULT_BRAND, LocaleCatalog, SUPPORTED_LOCALES } from '@axiom/core';
import { brandCopy } from './brand-copy';

describe('localized public branding', () => {
  const catalog = new LocaleCatalog(CATALOGS);
  it.each(SUPPORTED_LOCALES)('retains defaults and literal custom text in %s', locale => {
    const defaults = brandCopy(catalog, locale, DEFAULT_BRAND);
    expect(defaults('layout.home')).toContain('FanThynks');
    expect(defaults('brand.creatorIntelligence')).toBe(catalog.t(locale, 'brand.creatorIntelligence'));
    const custom = brandCopy(catalog, locale, { name: '<Studio & {email}>', tagline: 'One & <tagline>' });
    expect(custom('layout.home', { email: 'not-a-name' })).toContain('<Studio & {email}>');
    expect(custom('auth.createAccount')).toContain('<Studio & {email}>');
    expect(custom('brand.creatorIntelligence')).toBe('One & <tagline>');
  });
});
