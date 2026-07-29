import type { LinkInBioProvider, ProviderKind, AnalyticsData } from './registry.js';

/**
 * LinktreeProvider integrates with the Linktree API to manage a model's
 * Linktree profile and retrieve click analytics.
 *
 * Linktree is a popular hosted link-in-bio service. This provider wraps
 * its public (or partner) API.
 *
 * Stub implementation — real API calls would use a configured API token.
 */
export class LinktreeProvider implements LinkInBioProvider {
  readonly kind: ProviderKind = 'linktree';
  private enabled = false;
  private baseUrl: string;
  private apiToken?: string;

  constructor(baseUrl = 'https://api.linktr.ee', apiToken?: string) {
    this.baseUrl = baseUrl;
    this.apiToken = apiToken;
  }

  // -----------------------------------------------------------------------
  // LinkInBioProvider implementation
  // -----------------------------------------------------------------------

  async getProfile(modelId: string): Promise<Record<string, unknown>> {
    // Fetch the Linktree profile for this model.
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiToken) {
      headers['Authorization'] = `Bearer ${this.apiToken}`;
    }

    const response = await fetch(`${this.baseUrl}/profiles/${modelId}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error(`Linktree API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  async updateProfile(modelId: string, config: Record<string, unknown>): Promise<void> {
    // Update the Linktree profile — links, bio, appearance, etc.
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiToken) {
      headers['Authorization'] = `Bearer ${this.apiToken}`;
    }

    const response = await fetch(`${this.baseUrl}/profiles/${modelId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      throw new Error(`Linktree update error: ${response.status} ${response.statusText}`);
    }

    this.enabled = true;
  }

  async getAnalytics(modelId: string): Promise<AnalyticsData[]> {
    // Fetch click analytics from Linktree.
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiToken) {
      headers['Authorization'] = `Bearer ${this.apiToken}`;
    }

    try {
      const response = await fetch(`${this.baseUrl}/profiles/${modelId}/analytics`, {
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
        source: 'linktree' as const,
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
