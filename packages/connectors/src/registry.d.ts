import type { Platform } from '@axiom/core';
import type { SocialConnector, ConnectorCapability, ConnectorPublishInput, ValidationReport } from './types.js';
/**
 * Register a connector for a platform.
 */
export declare function register(connector: SocialConnector): void;
/**
 * Look up connector for a platform. Idempotent — returns the same instance.
 */
export declare function connectorFor(platform: Platform): SocialConnector;
/**
 * Check if a connector is registered for the platform.
 */
export declare function hasConnector(platform: Platform): boolean;
/**
 * Return all registered connectors.
 */
export declare function allConnectors(): SocialConnector[];
/**
 * Return all registered platform IDs.
 */
export declare function registeredPlatforms(): Platform[];
/**
 * Resolve capabilities for a registered connector.
 */
export declare function resolveCapabilities(platform: Platform): ConnectorCapability;
/**
 * Validate a publish input against a platform's connector.
 */
export declare function validateForPlatform(platform: Platform, input: ConnectorPublishInput): Promise<ValidationReport>;
//# sourceMappingURL=registry.d.ts.map