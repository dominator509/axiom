// ─── Connector Registry ───
/** Registry mapping Platform -> SocialConnector instance */
const registry = new Map();
/**
 * Register a connector for a platform.
 */
export function register(connector) {
    if (registry.has(connector.platform)) {
        throw new Error(`Connector for platform '${connector.platform}' already registered`);
    }
    registry.set(connector.platform, connector);
}
/**
 * Look up connector for a platform. Idempotent — returns the same instance.
 */
export function connectorFor(platform) {
    const connector = registry.get(platform);
    if (!connector) {
        throw new Error(`No connector registered for platform '${platform}'`);
    }
    return connector;
}
/**
 * Check if a connector is registered for the platform.
 */
export function hasConnector(platform) {
    return registry.has(platform);
}
/**
 * Return all registered connectors.
 */
export function allConnectors() {
    return Array.from(registry.values());
}
/**
 * Return all registered platform IDs.
 */
export function registeredPlatforms() {
    return Array.from(registry.keys());
}
/**
 * Resolve capabilities for a registered connector.
 */
export function resolveCapabilities(platform) {
    const connector = connectorFor(platform);
    return connector.capability();
}
/**
 * Validate a publish input against a platform's connector.
 */
export async function validateForPlatform(platform, input) {
    const connector = connectorFor(platform);
    return connector.validate(input);
}
//# sourceMappingURL=registry.js.map