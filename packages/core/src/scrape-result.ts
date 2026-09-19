/**
 * The only result shape allowed to cross the authenticated scraper UI boundary.
 * Provider payloads, internal errors and arbitrary fields are deliberately not
 * represented here. Observed zero remains distinct from an unavailable value.
 */
export type ScrapeResultKind = 'social' | 'competitor';

export type ScrapeResultState = 'completed' | 'partial' | 'failed' | 'empty' | 'unavailable';

/** Terminal states that are valid in the durable scrape_run record. */
export type PersistedScrapeRunState = 'completed' | 'partial' | 'failed';

export interface ScrapeProfileView {
  platform: string | null;
  displayName: string | null;
  profileUrl: string | null;
  bio: string | null;
  followers: number | null;
  following: number | null;
  posts: number | null;
  items: string[];
  error: 'unavailable' | null;
}

export interface ScrapeResultView {
  kind: ScrapeResultKind;
  state: ScrapeResultState;
  profiles: ScrapeProfileView[];
  observedProfiles: number;
  failedProfiles: number;
  totalItems: number;
  missingCount: number | null;
}

export const SCRAPE_RESULT_VIEW_LIMITS = {
  maxProfiles: 10,
  maxItemsPerProfile: 20,
  maxStringLength: 500,
  maxBioLength: 1_000,
  maxProfileUrlLength: 2_000,
  maxCount: 1_000_000_000_000,
} as const;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function observableCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function hasObservableProfileEvidence(value: JsonRecord): boolean {
  return [value.followers, value.following, value.posts].some(observableCount);
}

function hasError(value: JsonRecord): boolean {
  return value.error !== undefined && value.error !== null;
}

/**
 * Classify a validated sidecar response before it is written to scrape_run.
 * The worker and API use the same durable state vocabulary, so mixed results
 * cannot be persisted as completed and later rendered as partial.
 */
export function classifyPersistedScrapeRunState(
  kind: ScrapeResultKind,
  value: unknown,
): PersistedScrapeRunState {
  const raw = record(value);
  if (!raw) return 'failed';

  if (kind === 'social') {
    return hasError(raw) || !hasObservableProfileEvidence(raw) ? 'failed' : 'completed';
  }

  const results = raw.results;
  if (!Array.isArray(results) || results.length === 0) return 'failed';

  let observed = 0;
  let failed = 0;
  for (const result of results) {
    const row = record(result);
    if (!row || hasError(row)) failed += 1;
    else if (hasObservableProfileEvidence(row)) observed += 1;
  }

  if (observed === 0) return 'failed';
  return failed > 0 ? 'partial' : 'completed';
}
