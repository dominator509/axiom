/** Resolve the sidecar proxy URL for a model, or null when unbound/unhealthy. */
export declare function resolveEgressProxy(modelId: string): Promise<string | null>;
/**
 * Build a fetch implementation that routes through a sidecar proxy.
 * IMPORTANT: uses undici's OWN fetch (8.x) with the ProxyAgent (8.x), NOT
 * the global fetch (Node 24 bundles undici 7.x — passing an 8.x dispatcher
 * to the global fetch fails with `invalid onRequestStart method`).
 */
export declare function buildEgressFetch(proxyUrl: string): typeof fetch;
/** Clear the status cache (used by tests). */
export declare function clearEgressCache(): void;
//# sourceMappingURL=egress.d.ts.map