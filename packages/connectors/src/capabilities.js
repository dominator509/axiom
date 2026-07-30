// ─── Capability Resolution & Caching ───
import { connectorFor } from './registry.js';
/** Cache keyed by connector instance (auto-cleaned on dereference) */
let cache = new WeakMap();
/**
 * Resolve capabilities for a platform's registered connector.
 * Always delegates to the connector's `capability()` method.
 */
export function resolveCapabilities(platform) {
    const connector = connectorFor(platform);
    return connector.capability();
}
/**
 * Resolve capabilities with caching.
 * Returns the cached result if one exists for the connector instance,
 * otherwise calls `capability()`, caches it, and returns it.
 */
export function cacheCapability(platform) {
    const connector = connectorFor(platform);
    const cached = cache.get(connector);
    if (cached) {
        return cached;
    }
    const cap = connector.capability();
    cache.set(connector, cap);
    return cap;
}
/**
 * Clear the entire capability cache.
 * Creates a new WeakMap so the old one becomes eligible for GC.
 */
export function clearCapabilityCache() {
    cache = new WeakMap();
}
//# sourceMappingURL=capabilities.js.map