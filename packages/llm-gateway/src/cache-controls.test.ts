import { describe, expect, it } from 'vitest';
import {
  CACHE_CONTROL_PROVIDERS,
  applyCacheControl,
  anthropicCacheControl,
  canonicalCacheControls,
  deepseekCacheFields,
  openaiCacheFields,
} from './cache-controls.js';

describe('provider cache-control contracts', () => {
  it('keeps the provider set closed', () => {
    expect([...CACHE_CONTROL_PROVIDERS]).toEqual(['deepseek', 'anthropic', 'openai']);
  });

  it('preserves disabled defaults without emitting a directive', () => {
    const body = { model: 'gpt-4o' };
    expect(applyCacheControl(body, { provider: 'openai', enabled: false, prefixAlignment: true, promptCacheKey: 'x' }))
      .toEqual({ body, emitted: false, provider: null });
  });

  it('maps only the bounded OpenAI routing key', () => {
    expect(openaiCacheFields({ provider: 'openai', enabled: true, prefixAlignment: false, promptCacheKey: 'model:v1' }))
      .toEqual({ prompt_cache_key: 'model:v1' });
    expect(openaiCacheFields({ provider: 'openai', enabled: true, prefixAlignment: false, promptCacheKey: 'bad key!' }))
      .toEqual({});
  });

  it('exposes Anthropic breakpoint shape and no invented DeepSeek field', () => {
    expect(anthropicCacheControl({ provider: 'anthropic', enabled: true, prefixAlignment: true }))
      .toEqual({ type: 'ephemeral' });
    expect(deepseekCacheFields({ provider: 'deepseek', enabled: true, prefixAlignment: true }))
      .toEqual({});
  });

  it('includes enabled controls in response cache identity', () => {
    const a = canonicalCacheControls([{ provider: 'openai', enabled: true, prefixAlignment: false, promptCacheKey: 'a' }]);
    const b = canonicalCacheControls([{ provider: 'openai', enabled: true, prefixAlignment: false, promptCacheKey: 'b' }]);
    const disabled = canonicalCacheControls([{ provider: 'openai', enabled: false, prefixAlignment: false, promptCacheKey: 'a' }]);
    expect(a).not.toBe(b);
    expect(disabled).toContain('"promptCacheKey":null');
  });
});
