/** Wire shape of one model-scoped provider cache-control setting. */
export interface CacheControlView {
  provider: string;
  enabled: boolean;
  prefixAlignment: boolean;
  promptCacheKey: string | null;
}

export const CACHE_CONTROL_PROVIDER_ORDER = ['deepseek', 'anthropic', 'openai'] as const;

export function absentCacheControl(provider: string): CacheControlView {
  return { provider, enabled: false, prefixAlignment: false, promptCacheKey: null };
}
