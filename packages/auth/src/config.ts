export interface AuthRuntimeConfig {
  databaseUrl: string;
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
}

/**
 * Canonicalize the configured application URL to the value browsers send in
 * their Origin header. Origin headers never contain a trailing slash or a
 * path, while deployment configuration commonly does (for example,
 * `https://app.example/`). Keeping the canonical form in one place prevents
 * CORS, Better Auth, and OAuth redirect construction from disagreeing.
 */
export function normalizeAuthOrigin(value: string): string {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('BETTER_AUTH_URL must be a valid absolute URL');
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('BETTER_AUTH_URL must be an absolute HTTP(S) URL without credentials or query');
  }
  return parsed.origin;
}

/** Resolve auth configuration while allowing explicit local-development defaults. */
export function resolveAuthConfig(env: NodeJS.ProcessEnv): AuthRuntimeConfig {
  const environment = (env.AXIOM_ENV ?? env.NODE_ENV)?.trim();
  const localDevelopment = environment === 'development' || environment === 'test';
  // Unknown or missing environments fail closed like production. Only an
  // explicit development/test mode may use local defaults.
  const production = !localDevelopment;
  const databaseUrl = env.DATABASE_URL;
  const secret = env.BETTER_AUTH_SECRET;
  const baseURL = env.BETTER_AUTH_URL?.trim();

  if (production && !databaseUrl) throw new Error('DATABASE_URL is required in production');
  if (production && (!secret || secret.length < 32)) {
    throw new Error('BETTER_AUTH_SECRET must be at least 32 characters in production');
  }
  if (production && !baseURL) throw new Error('BETTER_AUTH_URL is required in production');

  if (production && baseURL) {
    let parsed: URL;
    try {
      parsed = new URL(baseURL);
    } catch {
      throw new Error('BETTER_AUTH_URL must be an absolute HTTPS URL in production');
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error('BETTER_AUTH_URL must be an absolute HTTPS URL in production');
    }
  }

  const resolvedBaseURL = normalizeAuthOrigin(baseURL ?? 'http://127.0.0.1:3001');

  return {
    databaseUrl: databaseUrl ?? 'postgresql://axiom:axiom@localhost:5432/axiom_dev',
    secret: secret ?? 'axiom-dev-secret-change-me',
    baseURL: resolvedBaseURL,
    trustedOrigins: production
      ? [resolvedBaseURL]
      : [resolvedBaseURL, 'http://127.0.0.1:3002', 'http://localhost:3002'],
  };
}
