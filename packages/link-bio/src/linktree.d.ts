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
export declare class LinktreeProvider implements LinkInBioProvider {
    readonly kind: ProviderKind;
    private enabled;
    private baseUrl;
    private apiToken?;
    constructor(baseUrl?: string, apiToken?: string);
    getProfile(modelId: string): Promise<Record<string, unknown>>;
    updateProfile(modelId: string, config: Record<string, unknown>): Promise<void>;
    getAnalytics(modelId: string): Promise<AnalyticsData[]>;
    getKind(): ProviderKind;
    isEnabled(): boolean;
}
//# sourceMappingURL=linktree.d.ts.map