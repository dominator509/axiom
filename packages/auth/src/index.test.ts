// ─── @axiom/auth — Vitest Suite ───
// Asserts the REAL better-auth configuration: email/password enabled,
// org-scoped sessions via the custom orgId additionalField, and a handler
// that serves the auth API. The organization plugin is intentionally NOT
// used — org scoping is resolved by the API middleware from auth_user.org_id.

import { describe, it, expect, beforeAll } from 'vitest';

// The auth module creates a pg.Pool at import time but does not connect until
// a query runs — a fake DATABASE_URL keeps construction safe and offline.
process.env.DATABASE_URL = 'postgres://test-user@localhost:5432/axiom_test';

let auth: any;

beforeAll(
  async () => {
    const mod = await import('./index.js');
    auth = mod.auth;
  },
  // better-auth has a large module graph. The import normally completes in a
  // few seconds, but can exceed Vitest's 10-second hook default when Turbo is
  // concurrently building and testing the full workspace on a loaded CI host.
  30_000,
);

describe('better-auth configuration', () => {
  it('exports a configured auth instance', () => {
    expect(auth).toBeDefined();
    expect(typeof auth.handler).toBe('function');
    expect(typeof auth.api).toBe('object');
  });

  it('enables email/password authentication', () => {
    expect(auth.options?.emailAndPassword?.enabled).toBe(true);
    expect(auth.options?.emailAndPassword?.minPasswordLength).toBe(8);
  });

  it('uses a server-assigned orgId additionalField (not the org plugin)', () => {
    const fields = auth.options?.user?.additionalFields ?? {};
    expect(fields.orgId).toBeDefined();
    expect(fields.orgId.input).toBe(false); // never settable from the client
    expect(fields.orgId.required).toBe(false);
    // The rewrite deliberately scopes via auth_user.org_id instead of the
    // organization plugin — assert the plugin is NOT enabled.
    expect(auth.options?.organization?.enabled ?? false).toBe(false);
  });

  it('uses a hardened cookie prefix and lax sameSite', () => {
    expect(auth.options?.advanced?.cookiePrefix).toBe('axiom');
    expect(auth.options?.advanced?.defaultCookieAttributes?.sameSite).toBe('lax');
  });

  it('exposes the runtime context and error codes', () => {
    expect(auth.$context).toBeDefined();
    expect(auth.$ERROR_CODES).toBeDefined();
  });

  it('exports the session and auth middleware helpers', async () => {
    const mod = await import('./index.js');
    expect(typeof mod.getSessionFromRequest).toBe('function');
    expect(typeof mod.requireAuth).toBe('function');
  });
});
