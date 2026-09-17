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

export interface MediaPlaneEnvironment {
  AXIOM_ENV?: string;
  NODE_ENV?: string;
  MEDIA_PLANE_URL?: string;
  MEDIA_PLANE_AUTH_TOKEN?: string;
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

/**
 * Require an explicit, reachable media-plane contract before a production
 * worker can claim jobs. The Rust sidecar may be loopback-local without a
 * bearer token; any other host must carry the matching internal token.
 */
export function requireProductionMediaPlaneConfig(env: MediaPlaneEnvironment): void {
  if (!isProductionEnvironment(env)) return;

  const rawUrl = env.MEDIA_PLANE_URL?.trim();
  if (!rawUrl) {
    throw new Error('MEDIA_PLANE_URL is required in production');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('MEDIA_PLANE_URL must be a valid absolute URL');
  }

  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== '/' ||
    !parsed.hostname
  ) {
    throw new Error('MEDIA_PLANE_URL must be an absolute HTTP(S) URL without credentials or query');
  }

  const loopbackHost = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(
    parsed.hostname.toLowerCase(),
  );
  if (!loopbackHost && !env.MEDIA_PLANE_AUTH_TOKEN?.trim()) {
    throw new Error('MEDIA_PLANE_AUTH_TOKEN is required for a non-loopback media plane');
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
