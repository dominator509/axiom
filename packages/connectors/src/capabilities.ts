// ─── Capability Resolution & Caching ───

import type { Platform } from '@axiom/core';
import type { ConnectorCapability, SocialConnector } from './types.js';
import { connectorFor } from './registry.js';

/** Cache keyed by connector instance (auto-cleaned on dereference) */
let cache = new WeakMap<SocialConnector, ConnectorCapability>();

/**
 * Resolve capabilities for a platform's registered connector.
 * Always delegates to the connector's `capability()` method.
 */
export function resolveCapabilities(platform: Platform): ConnectorCapability {
  const connector = connectorFor(platform);
  return connector.capability();
}

/**
 * Resolve capabilities with caching.
 * Returns the cached result if one exists for the connector instance,
 * otherwise calls `capability()`, caches it, and returns it.
 */
export function cacheCapability(platform: Platform): ConnectorCapability {
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
export function clearCapabilityCache(): void {
  cache = new WeakMap<SocialConnector, ConnectorCapability>();
}

/**
 * Serialize the structured connector declaration into the capability names
 * stored on platform_connection. This is deliberately derived from the
 * registered connector, never accepted from a client request.
 */
export function capabilityNames(capability: ConnectorCapability): string[] {
  const names: string[] = [];

  if (capability.publish) names.push('publish');
  for (const media of capability.media) names.push(`publish.${media}`);
  if (capability.scheduling !== 'none') names.push(`schedule.${capability.scheduling}`);
  if (capability.metrics.length > 0) names.push('read.insights');

  return names;
}
