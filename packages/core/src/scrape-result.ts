/**
 * The only result shape allowed to cross the authenticated scraper UI boundary.
 * Provider payloads, internal errors and arbitrary fields are deliberately not
 * represented here. Observed zero remains distinct from an unavailable value.
 */
export type ScrapeResultKind = 'social' | 'competitor';

export type ScrapeResultState = 'completed' | 'partial' | 'failed' | 'empty' | 'unavailable';

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
