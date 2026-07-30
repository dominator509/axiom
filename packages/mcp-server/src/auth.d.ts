/**
 * Agent permission tier enumeration.
 * Viewer  – read-only analytics and inbox (lowest privilege)
 * Operator – analytics, inbox (read+reply), generation (requires approval)
 * Manager  – operator + publishing (requires approval)
 * Autonomous – manager-level publishing (no approval needed) + network config
 */
export declare enum Tier {
    Viewer = "viewer",
    Operator = "operator",
    Manager = "manager",
    Autonomous = "autonomous"
}
/**
 * Check if `required` tier is satisfied by the agent's `actual` tier.
 * A viewer cannot call an operator tool; a manager can call any viewer/operator/manager tool.
 */
export declare function tierAtLeast(actual: Tier, required: Tier): boolean;
/** Resolved permission for an authenticated agent. */
export interface AgentPermission {
    /** Unique agent identifier. */
    agentId: string;
    /** The LLM model identifier the agent is acting as. */
    modelId: string;
    /** Granted permission tier. */
    tier: Tier;
    /** Capability scopes (reserved for future fine-grained control). */
    scopes: string[];
    /** The bearer token that was presented. */
    token: string;
    /** Expiry timestamp (ISO 8601) or null for never-expiring. */
    expiresAt: string | null;
}
/**
 * Create a capability token scoped to a specific model and tier.
 * Returns the raw token string. The caller is responsible for delivering it
 * to the agent out-of-band (e.g. via the Relay channel).
 */
export declare function createCapabilityToken(modelId: string, tier: Tier, agentId: string, ttlMs?: number): string;
/**
 * Validate a capability token.
 * Returns the resolved AgentPermission if valid, or null if the token
 * is unknown, expired, or malformed.
 */
export declare function validateToken(token: string): AgentPermission | null;
/**
 * Revoke a token so it can no longer be used.
 */
export declare function revokeToken(token: string): void;
/**
 * Authenticate an incoming MCP request.
 * Extracts the bearer token from an Authorization header or the `token`
 * field of the request params, validates it, and enforces that it
 * hasn't expired.
 *
 * @param request - An object representing the incoming request, expected
 *   to have either a `headers` map with an `authorization` key or a
 *   `params` object with a `token` field.
 * @returns Resolved AgentPermission
 * @throws {Error} If the token is missing or invalid.
 */
export declare function authenticateAgent(request: {
    headers?: Record<string, string>;
    params?: Record<string, unknown>;
}): AgentPermission;
/**
 * Resolve available tier given a model ID and an optional agent ID.
 * Returns the highest tier currently issued for the model.
 */
export declare function resolveHighestTier(modelId: string): Tier | null;
/**
 * Tier resolution — maps a capability token to a permission tier,
 * scoped per-model. Wraps the token-store functions in a class for
 * convenience.
 */
export declare class TierResolution {
    /**
     * Create a capability token and store it.
     */
    createToken(modelId: string, tier: Tier, agentId: string): string;
    /**
     * Validate a token and return the resolved permission.
     */
    validate(token: string): AgentPermission | null;
    /**
     * Authenticate a full request object.
     */
    authenticate(request: {
        headers?: Record<string, string>;
        params?: Record<string, unknown>;
    }): AgentPermission;
    /**
     * Revoke a previously issued token.
     */
    revoke(token: string): void;
    /**
     * Resolve the highest tier for a model across all issued tokens.
     */
    highestForModel(modelId: string): Tier | null;
}
//# sourceMappingURL=auth.d.ts.map