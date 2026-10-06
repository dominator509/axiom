/** Provider-reported prompt-cache usage. Missing values are unknown, not zero. */
export interface ProviderCacheUsage {
  /** Total effective input tokens, including cache reads and writes. */
  promptTokens: number;
  /** Input tokens the provider says were served from cache. */
  cachedPromptTokens: number;
  /** Input tokens the provider says were written to cache. */
  cacheCreationPromptTokens: number;
}

interface ProviderCacheUsageInput {
  /** Total prompt count; callers normalize provider-specific semantics first. */
  promptTokens: unknown;
  cachedPromptTokens?: unknown;
  cacheCreationPromptTokens?: unknown;
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Normalize explicit provider cache counters. No response fields means no
 * observation; malformed or inconsistent counters are also treated as unknown.
 */
export function normalizeProviderCacheUsage(
  input: ProviderCacheUsageInput,
): ProviderCacheUsage | undefined {
  if (input.cachedPromptTokens === undefined && input.cacheCreationPromptTokens === undefined) {
    return undefined;
  }

  const promptTokens = count(input.promptTokens);
  const cachedPromptTokens =
    input.cachedPromptTokens === undefined ? 0 : count(input.cachedPromptTokens);
  const cacheCreationPromptTokens =
    input.cacheCreationPromptTokens === undefined ? 0 : count(input.cacheCreationPromptTokens);

  if (
    promptTokens === undefined ||
    cachedPromptTokens === undefined ||
    cacheCreationPromptTokens === undefined ||
    cachedPromptTokens + cacheCreationPromptTokens > promptTokens
  ) {
    return undefined;
  }

  return { promptTokens, cachedPromptTokens, cacheCreationPromptTokens };
}

interface ProviderCacheTotals {
  observedResponses: number;
  unobservedResponses: number;
  promptTokens: number;
  cachedPromptTokens: number;
  cacheCreationPromptTokens: number;
}

const emptyTotals = (): ProviderCacheTotals => ({
  observedResponses: 0,
  unobservedResponses: 0,
  promptTokens: 0,
  cachedPromptTokens: 0,
  cacheCreationPromptTokens: 0,
});

function snapshotTotals(totals: ProviderCacheTotals) {
  return {
    ...totals,
    hitRate:
      totals.promptTokens === 0 ? null : totals.cachedPromptTokens / totals.promptTokens,
  };
}

/** Process-lifetime aggregate; it deliberately does not survive a restart. */
export class ProviderCacheTelemetry {
  private readonly providers = new Map<string, ProviderCacheTotals>();

  record(provider: string, usage: ProviderCacheUsage | undefined): void {
    const totals = this.providers.get(provider) ?? emptyTotals();
    if (!usage) {
      totals.unobservedResponses++;
    } else {
      totals.observedResponses++;
      totals.promptTokens += usage.promptTokens;
      totals.cachedPromptTokens += usage.cachedPromptTokens;
      totals.cacheCreationPromptTokens += usage.cacheCreationPromptTokens;
    }
    this.providers.set(provider, totals);
  }

  snapshot() {
    const providers = Object.fromEntries(
      [...this.providers.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([provider, totals]) => [provider, snapshotTotals(totals)]),
    );
    const total = [...this.providers.values()].reduce(
      (sum, value) => ({
        observedResponses: sum.observedResponses + value.observedResponses,
        unobservedResponses: sum.unobservedResponses + value.unobservedResponses,
        promptTokens: sum.promptTokens + value.promptTokens,
        cachedPromptTokens: sum.cachedPromptTokens + value.cachedPromptTokens,
        cacheCreationPromptTokens: sum.cacheCreationPromptTokens + value.cacheCreationPromptTokens,
      }),
      emptyTotals(),
    );

    return { scope: 'process-lifetime' as const, ...snapshotTotals(total), providers };
  }
}
