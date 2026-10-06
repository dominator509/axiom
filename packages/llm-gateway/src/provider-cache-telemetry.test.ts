import { describe, expect, it } from 'vitest';
import {
  normalizeProviderCacheUsage,
  ProviderCacheTelemetry,
} from './provider-cache-telemetry.js';

describe('provider cache telemetry', () => {
  it('leaves missing provider counters unobserved', () => {
    expect(normalizeProviderCacheUsage({ promptTokens: 100 })).toBeUndefined();
  });

  it('preserves an explicitly reported zero as a measured miss', () => {
    expect(normalizeProviderCacheUsage({ promptTokens: 100, cachedPromptTokens: 0 })).toEqual({
      promptTokens: 100,
      cachedPromptTokens: 0,
      cacheCreationPromptTokens: 0,
    });
  });

  it('rejects malformed, negative, non-integer, and impossible counts', () => {
    expect(normalizeProviderCacheUsage({ promptTokens: 50, cachedPromptTokens: -1 })).toBeUndefined();
    expect(normalizeProviderCacheUsage({ promptTokens: 50, cachedPromptTokens: 1.5 })).toBeUndefined();
    expect(
      normalizeProviderCacheUsage({
        promptTokens: 50,
        cachedPromptTokens: 40,
        cacheCreationPromptTokens: 11,
      }),
    ).toBeUndefined();
  });

  it('aggregates only explicit provider token counts and keeps unknown calls visible', () => {
    const telemetry = new ProviderCacheTelemetry();
    telemetry.record('provider-a', {
      promptTokens: 1000,
      cachedPromptTokens: 990,
      cacheCreationPromptTokens: 0,
    });
    telemetry.record('provider-a', undefined);
    telemetry.record('provider-b', {
      promptTokens: 100,
      cachedPromptTokens: 50,
      cacheCreationPromptTokens: 10,
    });

    expect(telemetry.snapshot()).toEqual({
      scope: 'process-lifetime',
      observedResponses: 2,
      unobservedResponses: 1,
      promptTokens: 1100,
      cachedPromptTokens: 1040,
      cacheCreationPromptTokens: 10,
      hitRate: 1040 / 1100,
      providers: {
        'provider-a': {
          observedResponses: 1,
          unobservedResponses: 1,
          promptTokens: 1000,
          cachedPromptTokens: 990,
          cacheCreationPromptTokens: 0,
          hitRate: 0.99,
        },
        'provider-b': {
          observedResponses: 1,
          unobservedResponses: 0,
          promptTokens: 100,
          cachedPromptTokens: 50,
          cacheCreationPromptTokens: 10,
          hitRate: 0.5,
        },
      },
    });
  });

  it('returns a null ratio before any token denominators are observed', () => {
    const telemetry = new ProviderCacheTelemetry();
    telemetry.record('provider-a', undefined);
    expect(telemetry.snapshot()).toMatchObject({
      observedResponses: 0,
      unobservedResponses: 1,
      promptTokens: 0,
      hitRate: null,
    });
  });
});
