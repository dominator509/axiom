import type { LinkInBioProvider, ProviderKind, AnalyticsData } from './registry.js';

/**
 * BeaconsProvider integrates with the Beacons.ai API to manage a model's
 * Beacons profile and retrieve analytics.
 *
 * Beacons is a popular link-in-bio / creator landing-page platform.
 * This provider wraps its API for profile management and analytics ingestion.
 *
 * Stub implementation — real API calls would use a configured API key.
 */
export class BeaconsProvider implements LinkInBioProvider {
  readonly kind: ProviderKind = 'beacons';
  private enabled = false;
  private baseUrl: string;
  private apiKey?: string;

  constructor(baseUrl = 'https://api.beacons.ai', apiKey?: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  // -----------------------------------------------------------------------
  // LinkInBioProvider implementation
  // -----------------------------------------------------------------------

  async getProfile(modelId: string): Promise<Record<string, unknown>> {
    // Fetch the Beacons profile for this model.
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    const response = await fetch(`${this.baseUrl}/v1/profiles/${modelId}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error(`Beacons API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  async updateProfile(modelId: string, config: Record<string, unknown>): Promise<void> {
    // Update the Beacons profile — links, theme, bio, media gallery, etc.
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    const response = await fetch(`${this.baseUrl}/v1/profiles/${modelId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      throw new Error(`Beacons update error: ${response.status} ${response.statusText}`);
    }

    this.enabled = true;
  }

  async getAnalytics(modelId: string): Promise<AnalyticsData[]> {
    // Fetch analytics from Beacons.
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    try {
      const response = await fetch(`${this.baseUrl}/v1/profiles/${modelId}/analytics`, {
        method: 'GET',
        headers,
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
        source: 'beacons' as const,
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
