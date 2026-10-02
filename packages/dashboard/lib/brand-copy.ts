import { type LocaleCatalog, type PublicBrand, type SupportedLocale } from '@axiom/core';

/** React renders these strings as text. Insert brand text after catalog interpolation
 * so braces remain literal and HTML-escaped interpolation is not escaped twice. */
export function brandCopy(catalog: LocaleCatalog, locale: SupportedLocale, brand: PublicBrand) {
  return (key: string, values?: Record<string, string | number>) => {
    if (key === 'brand.creatorIntelligence' && brand.tagline !== null) return brand.tagline;
    const marker = '__PUBLIC_BRAND_NAME__';
    return catalog.t(locale, key, { ...values, productName: marker }).replaceAll(marker, brand.name);
  };
}
