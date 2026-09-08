// ─── Shared production runtime configuration ───────────────────────────────

export interface RelaySecretEnvironment {
  NODE_ENV?: string;
  RELAY_SECRET?: string;
}

/** Resolve the relay signing secret without allowing a weak production fallback. */
export function resolveRelaySecret(env: RelaySecretEnvironment): string {
  const secret = env.RELAY_SECRET?.trim();
  if (env.NODE_ENV === 'production' && (!secret || secret.length < 32)) {
    throw new Error('RELAY_SECRET must be at least 32 characters in production');
  }
  return secret ?? 'axiom-dev-secret';
}
