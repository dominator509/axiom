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
export declare class FanlynksProvider implements LinkInBioProvider {
    readonly kind: ProviderKind;
    private enabled;
    private baseUrl;
    constructor(baseUrl?: string);
    getProfile(modelId: string): Promise<Record<string, unknown>>;
    updateProfile(modelId: string, config: Record<string, unknown>): Promise<void>;
    getAnalytics(modelId: string): Promise<AnalyticsData[]>;
    getKind(): ProviderKind;
    isEnabled(): boolean;
}
//# sourceMappingURL=fanlynks.d.ts.map