import type { Platform } from '@axiom/core';
import type { ConnectorCapability } from './types.js';
/**
 * Resolve capabilities for a platform's registered connector.
 * Always delegates to the connector's `capability()` method.
 */
export declare function resolveCapabilities(platform: Platform): ConnectorCapability;
/**
 * Resolve capabilities with caching.
 * Returns the cached result if one exists for the connector instance,
 * otherwise calls `capability()`, caches it, and returns it.
 */
export declare function cacheCapability(platform: Platform): ConnectorCapability;
/**
 * Clear the entire capability cache.
 * Creates a new WeakMap so the old one becomes eligible for GC.
 */
export declare function clearCapabilityCache(): void;
//# sourceMappingURL=capabilities.d.ts.map