export type ProviderKind = 'native' | 'fanlynks' | 'linktree' | 'beacons';
export interface ProviderConfig {
    kind: ProviderKind;
    enabled: boolean;
    config: Record<string, unknown>;
}
export interface AnalyticsData {
    clicks: number;
    views: number;
    date: string;
    source: string;
}
export interface LinkInBioProvider {
    /** Get the rendered profile page or JSON profile data for a model. */
    getProfile(modelId: string): Promise<string | Record<string, unknown>>;
    /** Update the provider's configuration for a given model. */
    updateProfile(modelId: string, config: Record<string, unknown>): Promise<void>;
    /** Retrieve analytics data for the model from this provider. */
    getAnalytics(modelId: string): Promise<AnalyticsData[]>;
    /** Return the provider kind identifier. */
    getKind(): ProviderKind;
    /** Whether this provider is currently enabled. */
    isEnabled(): boolean;
}
/**
 * LinkBioRegistry manages all Link-in-bio providers for the AXIOM system.
 * Each model can have multiple providers active simultaneously, with one
 * designated as the "primary" (the one shown at the main /link/:handle URL).
 */
export declare class LinkBioRegistry {
    readonly providers: Map<string, LinkInBioProvider>;
    /** Register a provider implementation so it can be used by models. */
    register(provider: LinkInBioProvider): void;
    /** Enable a provider for a given model with the supplied configuration. */
    enable(_modelId: string, kind: ProviderKind, config: Record<string, unknown>): Promise<void>;
    /** Disable a provider for a given model. */
    disable(_modelId: string, kind: ProviderKind): Promise<void>;
    /** Return all active (enabled) providers for a model. */
    getActiveProviders(_modelId: string): LinkInBioProvider[];
    /** Return the primary provider for a model (first enabled), or null. */
    getPrimaryProvider(modelId: string): LinkInBioProvider | null;
    /** Aggregate and normalize analytics from all active providers. */
    getNormalizedAnalytics(modelId: string): Promise<AnalyticsData[]>;
}
/** Singleton registry instance shared across the application. */
export declare const registry: LinkBioRegistry;
//# sourceMappingURL=registry.d.ts.map