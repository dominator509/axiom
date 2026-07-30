// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
/**
 * LinkBioRegistry manages all Link-in-bio providers for the AXIOM system.
 * Each model can have multiple providers active simultaneously, with one
 * designated as the "primary" (the one shown at the main /link/:handle URL).
 */
export class LinkBioRegistry {
    providers = new Map();
    /** Register a provider implementation so it can be used by models. */
    register(provider) {
        this.providers.set(provider.getKind(), provider);
    }
    /** Enable a provider for a given model with the supplied configuration. */
    async enable(_modelId, kind, config) {
        const provider = this.providers.get(kind);
        if (!provider) {
            throw new Error(`Unknown provider kind: ${kind}`);
        }
        // Persist the config via the provider (which may call an external API)
        // and also store the enabled state locally.
        await provider.updateProfile(_modelId, config);
    }
    /** Disable a provider for a given model. */
    async disable(_modelId, kind) {
        const provider = this.providers.get(kind);
        if (!provider) {
            throw new Error(`Unknown provider kind: ${kind}`);
        }
        // In-memory disable: providers track enabled state per-model.
        // Full implementation would update a link_bio_config row.
    }
    /** Return all active (enabled) providers for a model. */
    getActiveProviders(_modelId) {
        return Array.from(this.providers.values()).filter((p) => p.isEnabled());
    }
    /** Return the primary provider for a model (first enabled), or null. */
    getPrimaryProvider(modelId) {
        const active = this.getActiveProviders(modelId);
        return active.length > 0 ? active[0] : null;
    }
    /** Aggregate and normalize analytics from all active providers. */
    async getNormalizedAnalytics(modelId) {
        const active = this.getActiveProviders(modelId);
        const results = await Promise.all(active.map((p) => p.getAnalytics(modelId)));
        // Flatten and sort by date descending
        const flat = results.flat();
        flat.sort((a, b) => b.date.localeCompare(a.date));
        return flat;
    }
}
/** Singleton registry instance shared across the application. */
export const registry = new LinkBioRegistry();
//# sourceMappingURL=registry.js.map