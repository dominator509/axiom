// ─── Shared production runtime configuration ───────────────────────────────

export interface RelaySecretEnvironment {
  NODE_ENV?: string;
  RELAY_SECRET?: string;
}

export interface DatabaseEnvironment {
  NODE_ENV?: string;
  DATABASE_URL?: string;
}

/**
 * Prevent production services from silently falling back to a local/default
 * PostgreSQL connection string. Development and test callers may omit the
 * URL when they only exercise code that does not perform database I/O.
 */
export function requireProductionDatabaseUrl(env: DatabaseEnvironment): void {
  if (env.NODE_ENV === 'production' && !env.DATABASE_URL?.trim()) {
    throw new Error('DATABASE_URL is required in production');
  }
}

/** Resolve the relay signing secret without allowing a weak production fallback. */
export function resolveRelaySecret(env: RelaySecretEnvironment): string {
  const secret = env.RELAY_SECRET?.trim();
  if (env.NODE_ENV === 'production' && (!secret || secret.length < 32)) {
    throw new Error('RELAY_SECRET must be at least 32 characters in production');
  }
  return secret ?? 'axiom-dev-secret';
}
