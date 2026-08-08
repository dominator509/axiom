export interface AuthRuntimeConfig {
  databaseUrl: string;
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
}

/** Resolve auth configuration while allowing explicit local-development defaults. */
export function resolveAuthConfig(env: NodeJS.ProcessEnv): AuthRuntimeConfig {
  const production = env.NODE_ENV === 'production';
  const databaseUrl = env.DATABASE_URL;
  const secret = env.BETTER_AUTH_SECRET;
  const baseURL = env.BETTER_AUTH_URL;

  if (production && !databaseUrl) throw new Error('DATABASE_URL is required in production');
  if (production && (!secret || secret.length < 32)) {
    throw new Error('BETTER_AUTH_SECRET must be at least 32 characters in production');
  }
  if (production && !baseURL) throw new Error('BETTER_AUTH_URL is required in production');

  const resolvedBaseURL = baseURL ?? 'http://127.0.0.1:3001';

  return {
    databaseUrl: databaseUrl ?? 'postgresql://axiom:axiom@localhost:5432/axiom_dev',
    secret: secret ?? 'axiom-dev-secret-change-me',
    baseURL: resolvedBaseURL,
    trustedOrigins: production
      ? [resolvedBaseURL]
      : [resolvedBaseURL, 'http://127.0.0.1:3002', 'http://localhost:3002'],
  };
}
