import { describe, expect, it } from 'vitest';
import { DEFAULT_BRAND, normalizeBrandText, parsePublicBrand } from './brand.js';

describe('public brand contract', () => {
  it.each([undefined, null, [], 'text', 1])('defaults a missing or malformed projection (%j)', value => {
    expect(parsePublicBrand(value)).toEqual(DEFAULT_BRAND);
  });
  it('trims configured text and excludes unknown secret-bearing fields', () => {
    expect(parsePublicBrand({ name: ' Studio & <Co> ', tagline: ' My {name} ', secret: 'not-public' }))
      .toEqual({ name: 'Studio & <Co>', tagline: 'My {name}' });
  });
  it.each(['', ' ', 'A\nB', 'A\rB', 'A\tB', 'A\u0000B', 'A\u2028B', 'A\u2029B', 'x'.repeat(81)])(
    'defaults an invalid name independently (%j)', name => {
      expect(parsePublicBrand({ name, tagline: 'Valid' })).toEqual({ name: 'FanThynks', tagline: 'Valid' });
    });
  it('defaults an invalid tagline independently', () => {
    expect(parsePublicBrand({ name: 'Studio', tagline: 'x'.repeat(161) })).toEqual({ name: 'Studio', tagline: null });
  });
  it('counts Unicode code points and retains literal markup', () => {
    expect(normalizeBrandText('🌟'.repeat(80), 80)).toBe('🌟'.repeat(80));
    expect(normalizeBrandText('🌟'.repeat(81), 80)).toBeNull();
    expect(normalizeBrandText('<script>&{x}', 80)).toBe('<script>&{x}');
    expect(normalizeBrandText('x'.repeat(160), 160)).toHaveLength(160);
  });
});
