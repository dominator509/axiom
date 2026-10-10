/** Wire shape of one model-scoped provider cache-control setting. */
export interface CacheControlView {
  provider: string;
  enabled: boolean;
  prefixAlignment: boolean;
  promptCacheKey: string | null;
}

export type ProviderCacheTelemetryStatus = 'available' | 'partial' | 'unavailable';

export interface ProviderCacheTelemetryProvider {
  provider: string;
  status: ProviderCacheTelemetryStatus;
  successfulResponses: number;
  observedResponses: number;
  unobservedResponses: number;
  promptTokens: number;
  cachedPromptTokens: number;
  cacheCreationPromptTokens: number;
  cacheHitRate: number | null;
  windowStart: string;
  windowEnd: string;
}

export interface ProviderCacheTelemetryView {
  modelId: string;
  source: 'provider-reported';
  status: ProviderCacheTelemetryStatus;
  observedResponses: number;
  unobservedResponses: number;
  promptTokens: number;
  cachedPromptTokens: number;
  cacheCreationPromptTokens: number;
  cacheHitRate: number | null;
  windowStart: string | null;
  windowEnd: string | null;
  providers: ProviderCacheTelemetryProvider[];
}

export const CACHE_CONTROL_PROVIDER_ORDER = ['deepseek', 'anthropic', 'openai'] as const;

export function absentCacheControl(provider: string): CacheControlView {
  return { provider, enabled: false, prefixAlignment: false, promptCacheKey: null };
}
