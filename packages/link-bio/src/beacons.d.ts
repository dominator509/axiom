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
export declare class BeaconsProvider implements LinkInBioProvider {
    readonly kind: ProviderKind;
    private enabled;
    private baseUrl;
    private apiKey?;
    constructor(baseUrl?: string, apiKey?: string);
    getProfile(modelId: string): Promise<Record<string, unknown>>;
    updateProfile(modelId: string, config: Record<string, unknown>): Promise<void>;
    getAnalytics(modelId: string): Promise<AnalyticsData[]>;
    getKind(): ProviderKind;
    isEnabled(): boolean;
}
//# sourceMappingURL=beacons.d.ts.map