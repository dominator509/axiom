/** Public application branding. Never pass an environment object to a client. */
export interface PublicBrand {
  name: string;
  /** null preserves the existing localized default tagline. */
  tagline: string | null;
}
export const DEFAULT_BRAND: Readonly<PublicBrand> = Object.freeze({ name: 'FanThynks', tagline: null });

export function normalizeBrandText(value: unknown, limit: number): string | null {
  if (typeof value !== 'string' || /[\p{Cc}\u2028\u2029]/u.test(value)) return null;
  const text = value.trim();
  return text && Array.from(text).length <= limit ? text : null;
}

/** Whitelist the public projection, even if a response includes extra properties. */
export function parsePublicBrand(value: unknown): PublicBrand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_BRAND };
  const input = value as Record<string, unknown>;
  return {
    name: normalizeBrandText(input.name, 80) ?? DEFAULT_BRAND.name,
    tagline: normalizeBrandText(input.tagline, 160),
  };
}
