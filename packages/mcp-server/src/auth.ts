import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Agent permission tier enumeration.
 * Viewer  – read-only analytics and inbox (lowest privilege)
 * Operator – analytics, inbox (read+reply), generation (requires approval)
 * Manager  – operator + publishing (requires approval)
 * Autonomous – manager-level publishing (no approval needed) + network config
 */
export enum Tier {
  Viewer = 'viewer',
  Operator = 'operator',
  Manager = 'manager',
  Autonomous = 'autonomous',
}

/** Ordered tier weights for comparison. Higher = more privileged. */
const TIER_ORDER: Record<Tier, number> = {
  [Tier.Viewer]: 10,
  [Tier.Operator]: 20,
  [Tier.Manager]: 30,
  [Tier.Autonomous]: 40,
};

/**
 * Check if `required` tier is satisfied by the agent's `actual` tier.
 * A viewer cannot call an operator tool; a manager can call any viewer/operator/manager tool.
 */
export function tierAtLeast(actual: Tier, required: Tier): boolean {
  return TIER_ORDER[actual] >= TIER_ORDER[required];
}

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
  /** Expiry timestamp (ISO 8601) or null for never-expiring. */
  expiresAt: string | null;
}

export type TokenRevocationChecker = (tokenId: string) => Promise<boolean>;

export type TokenRevocationWriter = (input: {
  tokenId: string;
  expiresAt: string;
}) => Promise<void>;

// ─── Capability state ──────────────────────────────────────────────────────
// Tokens are signed and self-contained so they remain valid across process
// restarts and multiple API instances. Local state is only a fast-path cache;
// the mounted API uses the async verifier backed by the durable revocation
// denylist.

const issuedTokens = new Map<string, AgentPermission>();
const revokedTokenHashes = new Set<string>();
const DEFAULT_CAPABILITY_TTL_MS = 15 * 60_000;
// Capability tokens are delivered in an Authorization header. Keep malformed
// or hostile headers from reaching hashing, HMAC verification, or JSON parsing.
// Normal AXIOM tokens contain UUIDs and short agent identifiers, so 4 KiB leaves
// ample room for legitimate credentials without accepting unbounded input.
const MAX_CAPABILITY_TOKEN_BYTES = 4 * 1024;

interface CapabilityPayload extends Omit<AgentPermission, 'expiresAt'> {
  version: 1;
  tokenId: string;
  kid: string;
  expiresAt: string;
}

// ─── Token helpers ──────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random capability token.
 * Returns a hex-encoded 32-byte string.
 */
function signingKey(): { kid: string; secret: string } {
  const secret = process.env.BETTER_AUTH_SECRET;
  const resolvedSecret =
    secret && Buffer.byteLength(secret) >= 32
      ? secret
      : process.env.NODE_ENV === 'test'
        ? 'axiom-mcp-test-signing-key-32-bytes-minimum'
        : null;
  if (!resolvedSecret) {
    throw new Error('BETTER_AUTH_SECRET (32+ bytes) is required for MCP token signing');
  }
  const kid = process.env.MCP_TOKEN_KID?.trim() || 'default';
  return { kid, secret: resolvedSecret };
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function signPayload(payload: CapabilityPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', signingKey().secret)
    .update(`v1.${encoded}`)
    .digest('base64url');
  return `v1.${encoded}.${signature}`;
}

function decodeToken(token: string): CapabilityPayload | null {
  if (Buffer.byteLength(token, 'utf8') > MAX_CAPABILITY_TOKEN_BYTES) return null;

  const [version, encoded, suppliedSignature, extra] = token.split('.');
  if (version !== 'v1' || !encoded || !suppliedSignature || extra) return null;
  const key = signingKey();
  const expected = createHmac('sha256', key.secret).update(`v1.${encoded}`).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(suppliedSignature, 'base64url');
  } catch {
    return null;
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as CapabilityPayload;
    if (
      payload.version !== 1 ||
      !payload.tokenId ||
      payload.kid !== key.kid ||
      !payload.agentId ||
      !payload.modelId ||
      !Object.values(Tier).includes(payload.tier) ||
      !Array.isArray(payload.scopes) ||
      typeof payload.expiresAt !== 'string'
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Create a capability token scoped to a specific model and tier.
 * Returns the raw token string. The caller is responsible for delivering it
 * to the agent out-of-band (e.g. via the Relay channel).
 */
export function createCapabilityToken(
  modelId: string,
  tier: Tier,
  agentId: string,
  ttlMs: number = DEFAULT_CAPABILITY_TTL_MS,
): string {
  const { kid } = signingKey();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const payload: CapabilityPayload = {
    version: 1,
    tokenId: randomBytes(16).toString('hex'),
    kid,
    agentId,
    modelId,
    tier,
    scopes: [],
    expiresAt,
  };
  const token = signPayload(payload);
  issuedTokens.set(tokenHash(token), payload);
  return token;
}

/**
 * Validate a capability token.
 * Returns the resolved AgentPermission if valid, or null if the token
 * is unknown, expired, or malformed.
 */
export function validateToken(token: string): AgentPermission | null {
  const permission = resolveToken(token);
  return permission;
}

function resolveToken(token: string): CapabilityPayload | null {
  if (Buffer.byteLength(token, 'utf8') > MAX_CAPABILITY_TOKEN_BYTES) return null;

  const hash = tokenHash(token);
  if (revokedTokenHashes.has(hash)) return null;
  const permission = decodeToken(token);
  if (!permission) return null;
  // Check expiry
  if (permission.expiresAt) {
    const expires = new Date(permission.expiresAt).getTime();
    if (Date.now() > expires) {
      issuedTokens.delete(hash);
      return null;
    }
  }
  return permission;
}

/**
 * Validate a token against the durable revocation source used by production
 * API instances. The synchronous validator remains available for pure local
 * callers, but it must not be used by the mounted HTTP transport.
 */
export async function validateTokenAsync(
  token: string,
  isRevoked: TokenRevocationChecker,
): Promise<AgentPermission | null> {
  const permission = resolveToken(token);
  if (!permission) return null;
  if (await isRevoked(permission.tokenId)) return null;
  return permission;
}

/**
 * Revoke a token so it can no longer be used.
 */
export function revokeToken(token: string): void {
  const hash = tokenHash(token);
  issuedTokens.delete(hash);
  revokedTokenHashes.add(hash);
}

/** Persist a revocation and invalidate this process's fast-path cache. */
export async function revokeTokenDurably(
  token: string,
  persist: TokenRevocationWriter,
): Promise<void> {
  const payload = decodeToken(token);
  revokeToken(token);
  if (!payload) return;
  await persist({ tokenId: payload.tokenId, expiresAt: payload.expiresAt });
}

/**
 * Authenticate an incoming MCP request.
 * Extracts the bearer token from the Authorization header, validates it, and
 * enforces that it has not expired. Tokens in JSON-RPC params are deliberately
 * rejected because bodies are routinely captured by request logs and traces.
 *
 * @param request - An object representing the incoming request, expected
 *   to have a `headers` map with an `authorization` key.
 * @returns Resolved AgentPermission
 * @throws {Error} If the token is missing or invalid.
 */
export function authenticateAgent(request: {
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
}): AgentPermission {
  const token = bearerToken(request);
  if (!token) {
    throw new Error('Authentication required: no token provided');
  }
  const permission = validateToken(token);
  if (!permission) {
    throw new Error('Authentication failed: invalid or expired token');
  }
  return permission;
}

/** Authenticate through a durable revocation checker. */
export async function authenticateAgentAsync(
  request: {
    headers?: Record<string, string>;
    params?: Record<string, unknown>;
  },
  isRevoked: TokenRevocationChecker,
): Promise<AgentPermission> {
  const token = bearerToken(request);
  if (!token) {
    throw new Error('Authentication required: no token provided');
  }
  const permission = await validateTokenAsync(token, isRevoked);
  if (!permission) {
    throw new Error('Authentication failed: invalid or expired token');
  }
  return permission;
}

function bearerToken(request: {
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
}): string | undefined {
  const authHeader = request.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();
  return undefined;
}

/**
 * Resolve available tier given a model ID and an optional agent ID.
 * Returns the highest tier currently issued for the model.
 */
export function resolveHighestTier(modelId: string): Tier | null {
  let highest: Tier | null = null;
  let highestWeight = 0;
  for (const permission of issuedTokens.values()) {
    if (permission.modelId === modelId) {
      // Skip expired tokens — an expired capability must not elevate tier
      if (permission.expiresAt) {
        const expires = new Date(permission.expiresAt).getTime();
        if (Date.now() > expires) continue;
      }
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
  createToken(modelId: string, tier: Tier, agentId: string): string {
    return createCapabilityToken(modelId, tier, agentId);
  }

  /**
   * Validate a token and return the resolved permission.
   */
  validate(token: string): AgentPermission | null {
    return validateToken(token);
  }

  /**
   * Authenticate a full request object.
   */
  authenticate(request: {
    headers?: Record<string, string>;
    params?: Record<string, unknown>;
  }): AgentPermission {
    return authenticateAgent(request);
  }

  /**
   * Revoke a previously issued token.
   */
  revoke(token: string): void {
    revokeToken(token);
  }

  async revokeDurably(token: string, persist: TokenRevocationWriter): Promise<void> {
    await revokeTokenDurably(token, persist);
  }

  /**
   * Resolve the highest tier for a model across all issued tokens.
   */
  highestForModel(modelId: string): Tier | null {
    return resolveHighestTier(modelId);
  }
}
