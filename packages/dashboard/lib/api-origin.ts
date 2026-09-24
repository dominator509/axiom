const LOCAL_API_ORIGIN = 'http://127.0.0.1:3001';

type ApiOriginEnvironment = {
  AXIOM_ENV?: string;
  API_ORIGIN?: string;
  NODE_ENV?: string;
};

// Keep this resolver self-contained because Next evaluates next.config.ts
// before workspace package entrypoints are guaranteed to be built. The
// selector mirrors @axiom/core: AXIOM_ENV is authoritative and unknown or
// missing values fail closed as production-like.
function isProductionEnvironment(env: ApiOriginEnvironment): boolean {
  const environment = (env.AXIOM_ENV ?? env.NODE_ENV)?.trim();
  return environment !== 'development' && environment !== 'test';
}

/**
 * Resolve the server-side API origin used by Next rewrites and RSC requests.
 * Production images run separately from the Hono container, so a silent
 * loopback fallback would make the dashboard look alive while every session
 * and data request fails inside the dashboard container.
 */
export function resolveApiOrigin(env: ApiOriginEnvironment = process.env): string {
  const configured = env.API_ORIGIN?.trim();
  if (!configured) {
    if (isProductionEnvironment(env)) {
      throw new Error('API_ORIGIN is required in production');
    }
    return LOCAL_API_ORIGIN;
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('API_ORIGIN must be a valid absolute HTTP(S) URL');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('API_ORIGIN must be an absolute HTTP(S) URL without credentials or query');
  }

  return parsed.origin;
}
