/**
 * F-33 — bounded provider cache-control contracts.
 *
 * Only provider request shapes already described by the architecture are
 * emitted. Unknown, disabled, or malformed settings remain inert; active
 * subscription transports fail closed in gateway.ts instead of silently
 * dropping an operator's enabled control.
 */

export const CACHE_CONTROL_PROVIDERS = ['deepseek', 'anthropic', 'openai'] as const;
export type CacheControlProvider = (typeof CACHE_CONTROL_PROVIDERS)[number];
export const CACHE_CONTROL_UNSUPPORTED_CODE = 'CACHE_CONTROL_TRANSPORT_UNSUPPORTED';

export interface CacheControlSetting {
  provider: string;
  enabled: boolean;
  prefixAlignment: boolean;
  promptCacheKey?: string | null;
}

const PROMPT_CACHE_KEY = /^[A-Za-z0-9._:-]{1,64}$/;

export function isCacheControlProvider(value: string): value is CacheControlProvider {
  return (CACHE_CONTROL_PROVIDERS as readonly string[]).includes(value);
}

export function isValidPromptCacheKey(value: unknown): value is string {
  return typeof value === 'string' && PROMPT_CACHE_KEY.test(value);
}

export function anthropicCacheControl(
  setting: CacheControlSetting | null | undefined,
): { type: 'ephemeral' } | null {
  if (!setting || setting.provider !== 'anthropic' || !setting.enabled || !setting.prefixAlignment) return null;
  return { type: 'ephemeral' };
}

export function deepseekCacheFields(
  setting: CacheControlSetting | null | undefined,
): Record<string, never> {
  // DeepSeek prefix caching is automatic; this repository has no documented
  // request field to emit for it.
  if (!setting || setting.provider !== 'deepseek' || !setting.enabled) return {};
  return {};
}

export function openaiCacheFields(
  setting: CacheControlSetting | null | undefined,
): { prompt_cache_key?: string } {
  if (!setting || setting.provider !== 'openai' || !setting.enabled) return {};
  return isValidPromptCacheKey(setting.promptCacheKey)
    ? { prompt_cache_key: setting.promptCacheKey }
    : {};
}

export function applyCacheControl<T extends Record<string, unknown>>(
  body: T,
  setting: CacheControlSetting | null | undefined,
): { body: T; emitted: boolean; provider: CacheControlProvider | null } {
  const next = { ...body } as T;
  if (!setting || !isCacheControlProvider(setting.provider) || !setting.enabled) {
    return { body: next, emitted: false, provider: null };
  }

  if (setting.provider === 'anthropic') {
    const tag = anthropicCacheControl(setting);
    const system = next.system;
    if (tag && typeof system === 'string' && system.length > 0) {
      (next as Record<string, unknown>).system = [{ type: 'text', text: system, cache_control: tag }];
      return { body: next, emitted: true, provider: 'anthropic' };
    }
    return { body: next, emitted: false, provider: 'anthropic' };
  }

  if (setting.provider === 'openai') {
    const fields = openaiCacheFields(setting);
    if (Object.keys(fields).length > 0) {
      return { body: { ...next, ...fields } as T, emitted: true, provider: 'openai' };
    }
    return { body: next, emitted: false, provider: 'openai' };
  }

  // DeepSeek has automatic prefix caching and no request directive here.
  deepseekCacheFields(setting);
  return { body: next, emitted: false, provider: 'deepseek' };
}

/** Align TOKENKILLER's static prefix only when the persisted control asks for it. */
export function shouldAlignPrefix(setting: CacheControlSetting | null | undefined): boolean {
  return Boolean(setting?.enabled && setting.prefixAlignment && isCacheControlProvider(setting.provider));
}

export function defaultCacheControlSetting(provider: string): CacheControlSetting {
  return { provider, enabled: false, prefixAlignment: false, promptCacheKey: null };
}

/** Stable, secret-free cache-key representation for gateway response caching. */
export function canonicalCacheControls(settings: readonly CacheControlSetting[] | undefined): string {
  return JSON.stringify(
    (settings ?? [])
      .map(setting => ({
        provider: setting.provider,
        enabled: setting.enabled === true,
        prefixAlignment: setting.prefixAlignment === true,
        promptCacheKey: setting.enabled && isValidPromptCacheKey(setting.promptCacheKey)
          ? setting.promptCacheKey
          : null,
      }))
      .sort((a, b) => a.provider.localeCompare(b.provider)),
  );
}
