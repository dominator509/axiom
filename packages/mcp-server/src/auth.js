import { randomBytes } from 'node:crypto';
/**
 * Agent permission tier enumeration.
 * Viewer  – read-only analytics and inbox (lowest privilege)
 * Operator – analytics, inbox (read+reply), generation (requires approval)
 * Manager  – operator + publishing (requires approval)
 * Autonomous – manager-level publishing (no approval needed) + network config
 */
export var Tier;
(function (Tier) {
    Tier["Viewer"] = "viewer";
    Tier["Operator"] = "operator";
    Tier["Manager"] = "manager";
    Tier["Autonomous"] = "autonomous";
})(Tier || (Tier = {}));
/** Ordered tier weights for comparison. Higher = more privileged. */
const TIER_ORDER = {
    [Tier.Viewer]: 10,
    [Tier.Operator]: 20,
    [Tier.Manager]: 30,
    [Tier.Autonomous]: 40,
};
/**
 * Check if `required` tier is satisfied by the agent's `actual` tier.
 * A viewer cannot call an operator tool; a manager can call any viewer/operator/manager tool.
 */
export function tierAtLeast(actual, required) {
    return TIER_ORDER[actual] >= TIER_ORDER[required];
}
// ─── Token store ────────────────────────────────────────────────────────────
// In production this would be backed by Redis / database with TTLs.
// For the single-box deployment model a local Map is sufficient.
const tokenStore = new Map();
// ─── Token helpers ──────────────────────────────────────────────────────────
/**
 * Generate a cryptographically random capability token.
 * Returns a hex-encoded 32-byte string.
 */
function generateToken() {
    return randomBytes(32).toString('hex');
}
/**
 * Create a capability token scoped to a specific model and tier.
 * Returns the raw token string. The caller is responsible for delivering it
 * to the agent out-of-band (e.g. via the Relay channel).
 */
export function createCapabilityToken(modelId, tier, agentId, ttlMs = 3600_000) {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const permission = {
        agentId,
        modelId,
        tier,
        scopes: [],
        token,
        expiresAt,
    };
    tokenStore.set(token, permission);
    return token;
}
/**
 * Validate a capability token.
 * Returns the resolved AgentPermission if valid, or null if the token
 * is unknown, expired, or malformed.
 */
export function validateToken(token) {
    const permission = tokenStore.get(token);
    if (!permission)
        return null;
    // Check expiry
    if (permission.expiresAt) {
        const expires = new Date(permission.expiresAt).getTime();
        if (Date.now() > expires) {
            tokenStore.delete(token);
            return null;
        }
    }
    return permission;
}
/**
 * Revoke a token so it can no longer be used.
 */
export function revokeToken(token) {
    tokenStore.delete(token);
}
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
export function authenticateAgent(request) {
    // Try bearer token from headers first
    let token;
    const authHeader = request.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7).trim();
    }
    // Fall back to params.token
    if (!token && request.params?.token) {
        token = String(request.params.token);
    }
    if (!token) {
        throw new Error('Authentication required: no token provided');
    }
    const permission = validateToken(token);
    if (!permission) {
        throw new Error('Authentication failed: invalid or expired token');
    }
    return permission;
}
/**
 * Resolve available tier given a model ID and an optional agent ID.
 * Returns the highest tier currently issued for the model.
 */
export function resolveHighestTier(modelId) {
    let highest = null;
    let highestWeight = 0;
    for (const permission of tokenStore.values()) {
        if (permission.modelId === modelId) {
            const weight = TIER_ORDER[permission.tier];
            if (weight > highestWeight) {
                highest = permission.tier;
                highestWeight = weight;
            }
        }
    }
    return highest;
}
/**
 * Tier resolution — maps a capability token to a permission tier,
 * scoped per-model. Wraps the token-store functions in a class for
 * convenience.
 */
export class TierResolution {
    /**
     * Create a capability token and store it.
     */
    createToken(modelId, tier, agentId) {
        return createCapabilityToken(modelId, tier, agentId);
    }
    /**
     * Validate a token and return the resolved permission.
     */
    validate(token) {
        return validateToken(token);
    }
    /**
     * Authenticate a full request object.
     */
    authenticate(request) {
        return authenticateAgent(request);
    }
    /**
     * Revoke a previously issued token.
     */
    revoke(token) {
        revokeToken(token);
    }
    /**
     * Resolve the highest tier for a model across all issued tokens.
     */
    highestForModel(modelId) {
        return resolveHighestTier(modelId);
    }
}
//# sourceMappingURL=auth.js.map