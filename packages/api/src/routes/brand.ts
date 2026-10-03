import { Hono } from 'hono';
import { DEFAULT_BRAND, normalizeBrandText, type PublicBrand } from '@axiom/core';

type BrandEnvironment = { AXIOM_BRAND_NAME?: string; AXIOM_BRAND_TAGLINE?: string };

/** Resolve once at startup. Diagnostic messages contain field names only. */
export function createBrandRouter(
  env: BrandEnvironment,
  warn: (message: string) => void = console.warn,
): Hono {
  const read = (key: keyof BrandEnvironment, limit: number) => {
    const value = normalizeBrandText(env[key], limit);
    if (env[key] !== undefined && value === null) warn('Invalid branding field: ' + key);
    return value;
  };
  const brand: PublicBrand = {
    name: read('AXIOM_BRAND_NAME', 80) ?? DEFAULT_BRAND.name,
    tagline: read('AXIOM_BRAND_TAGLINE', 160),
  };
  const router = new Hono();
  router.get('/', c => {
    c.header('Cache-Control', 'no-store');
    return c.json({ data: brand });
  });
  return router;
}
