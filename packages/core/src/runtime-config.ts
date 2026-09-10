// ─── Shared production runtime configuration ───────────────────────────────

export interface RelaySecretEnvironment {
  AXIOM_ENV?: string;
  NODE_ENV?: string;
  RELAY_SECRET?: string;
}

export interface DatabaseEnvironment {
  AXIOM_ENV?: string;
  NODE_ENV?: string;
  DATABASE_URL?: string;
}

/**
 * Resolve the deployment environment consistently across services. Unknown
 * or missing values are production-like so a mislabeled process cannot opt
 * into development fallbacks.
 */
export function isProductionEnvironment(env: {
  AXIOM_ENV?: string;
  NODE_ENV?: string;
}): boolean {
  const environment = (env.AXIOM_ENV ?? env.NODE_ENV)?.trim();
  return environment !== 'development' && environment !== 'test';
}

/** Default control-plane URL shared by every Node-side egress caller. */
export const DEFAULT_EGRESS_PLANE_URL = 'http://127.0.0.1:9090';

/**
 * Prevent production services from silently falling back to a local/default
 * PostgreSQL connection string. Development and test callers may omit the
 * URL when they only exercise code that does not perform database I/O.
 */
export function requireProductionDatabaseUrl(env: DatabaseEnvironment): void {
  if (isProductionEnvironment(env) && !env.DATABASE_URL?.trim()) {
    throw new Error('DATABASE_URL is required in production');
  }
}

/** Resolve the relay signing secret without allowing a weak production fallback. */
export function resolveRelaySecret(env: RelaySecretEnvironment): string {
  const secret = env.RELAY_SECRET?.trim();
  if (isProductionEnvironment(env) && (!secret || secret.length < 32)) {
    throw new Error('RELAY_SECRET must be at least 32 characters in production');
  }
  return secret ?? 'axiom-dev-secret';
}
