import type { LinkInBioProvider, ProviderKind, AnalyticsData } from './registry.js';
/**
 * NativeLinkBioProvider renders a self-hosted link-in-bio HTML page for
 * any AXIOM model profile. Click tracking is done via the post_metric table.
 *
 * This is the fallback provider that requires no external service — every
 * model gets a working page at /link/:handle by default.
 */
export declare class NativeLinkBioProvider implements LinkInBioProvider {
    readonly kind: ProviderKind;
    private enabled;
    getProfile(_modelId: string): Promise<string>;
    updateProfile(_modelId: string, config: Record<string, unknown>): Promise<void>;
    getAnalytics(_modelId: string): Promise<AnalyticsData[]>;
    getKind(): ProviderKind;
    isEnabled(): boolean;
}
//# sourceMappingURL=native.d.ts.map