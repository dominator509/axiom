import type { LinkInBioProvider, ProviderKind, AnalyticsData } from './registry.js';

/**
 * FanlynksProvider manages a self-hosted Fanlynks instance for a model.
 *
 * Fanlynks is an open-source link-in-bio platform that can be deployed
 * via Docker. This provider communicates with the Fanlynks management API
 * to create, update, and monitor profile pages.
 *
 * Stub implementation — real API calls would go to a configurable endpoint.
 */
export class FanlynksProvider implements LinkInBioProvider {
  readonly kind: ProviderKind = 'fanlynks';
  private enabled = false;
  private baseUrl: string;

  constructor(baseUrl = 'https://api.fanlynks.example.com') {
    this.baseUrl = baseUrl;
  }

  // -----------------------------------------------------------------------
  // LinkInBioProvider implementation
  // -----------------------------------------------------------------------

  async getProfile(modelId: string): Promise<Record<string, unknown>> {
    // Fetch the Fanlynks profile page or JSON representation for the model.
    const response = await fetch(`${this.baseUrl}/profiles/${modelId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Fanlynks API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  async updateProfile(modelId: string, config: Record<string, unknown>): Promise<void> {
    // Deploy or update a Fanlynks profile with dynamic content.
    // The config may include: displayName, bio, avatarUrl, links[], theme, etc.
    const response = await fetch(`${this.baseUrl}/profiles/${modelId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      throw new Error(`Fanlynks update error: ${response.status} ${response.statusText}`);
    }

    this.enabled = true;
  }

  async getAnalytics(modelId: string): Promise<AnalyticsData[]> {
    // Fetch click/view analytics from the Fanlynks instance.
    // Fanlynks may ingest GA4 / GTM / Pixel data and expose it via its API.
    try {
      const response = await fetch(`${this.baseUrl}/profiles/${modelId}/analytics`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as Array<{
        clicks?: number;
        views?: number;
        date?: string;
      }>;

      return data.map((entry) => ({
        clicks: entry.clicks ?? 0,
        views: entry.views ?? 0,
        date: entry.date ?? new Date().toISOString().slice(0, 10),
        source: 'fanlynks' as const,
      }));
    } catch {
      return [];
    }
  }

  getKind(): ProviderKind {
    return this.kind;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
