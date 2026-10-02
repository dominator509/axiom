import { cache } from 'react';
import { DEFAULT_BRAND, parsePublicBrand, readBoundedResponseJson, type PublicBrand } from '@axiom/core';
import { resolveApiOrigin } from './api-origin';

/** Server rendering only: no cookies or environment projection in this public request. */
export async function fetchPublicBrand(): Promise<PublicBrand> {
  try {
    const response = await fetch(resolveApiOrigin() + '/api/v1/brand', {
      cache: 'no-store',
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return { ...DEFAULT_BRAND };
    const body = await readBoundedResponseJson(response, 2_000) as { data?: unknown } | null;
    return parsePublicBrand(body?.data);
  } catch {
    return { ...DEFAULT_BRAND };
  }
}
export const getPublicBrand = cache(fetchPublicBrand);
