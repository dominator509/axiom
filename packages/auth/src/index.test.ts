// ─── @axiom/auth — Vitest Suite ───
// Asserts the REAL better-auth configuration: email/password enabled,
// org-scoped sessions via the custom orgId additionalField, and a handler
// that serves the auth API. The organization plugin is intentionally NOT
// used — org scoping is resolved by the API middleware from auth_user.org_id.

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { getCookies } from 'better-auth/cookies';
import type { UserRole } from '@axiom/core';

// The auth module creates a pg.Pool at import time but does not connect until
// a query runs — a fake DATABASE_URL keeps construction safe and offline.
process.env.DATABASE_URL = 'postgres://test-user@localhost:5432/axiom_test';

let auth: any;
let requireRole: typeof import('./index.js').requireRole;
let requireMutationRole: typeof import('./index.js').requireMutationRole;

beforeAll(
  async () => {
    const mod = await import('./index.js');
    auth = mod.auth;
    requireRole = mod.requireRole;
    requireMutationRole = mod.requireMutationRole;
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

  it('does not advertise a successful email-verification transport without one', () => {
    expect(auth.options?.emailVerification?.sendVerificationEmail).toBeUndefined();
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

  it.each([
    ['https://phone.usw3.devtunnels.ms', true],
    ['https://app.example', true],
    ['http://127.0.0.1:3002', false],
  ])('keeps real cookie names and Secure attributes consistent for %s', (baseURL, secure) => {
    const cookies = getCookies({ ...auth.options, baseURL });
    for (const cookie of Object.values(cookies)) {
      expect(cookie.attributes.secure).toBe(secure);
      expect(cookie.name.startsWith('__Secure-')).toBe(secure);
      expect(cookie.attributes.httpOnly).toBe(true);
      expect(cookie.attributes.sameSite).toBe('lax');
    }
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

  it('exposes the server-assigned role as a non-client-configurable field', () => {
    const fields = auth.options?.user?.additionalFields ?? {};
    expect(fields.role).toBeDefined();
    expect(fields.role.input).toBe(false);
  });
});

describe('REST role middleware', () => {
  type Bindings = {
    Variables: { userId: string; orgId: string; role: UserRole | null };
  };

  function appFor(role: UserRole | null, middleware: ReturnType<typeof requireRole>) {
    const app = new Hono<Bindings>();
    app.use('*', async (c, next) => {
      c.set('userId', 'user-1');
      c.set('orgId', 'org-1');
      c.set('role', role);
      return await middleware(c, next);
    });
    app.post('/mutate', (c) => c.json({ ok: true }));
    return app;
  }

  it('denies a lower-privilege role from owner-only controls', async () => {
    const res = await appFor('analyst', requireRole('owner')).request('/mutate', {
      method: 'POST',
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Type')).toMatch(/^application\/problem\+json/);
  });

  it('allows an operator to use operational mutation paths', async () => {
    const res = await appFor('operator', requireMutationRole('owner', 'manager', 'operator')).request(
      '/mutate',
      { method: 'POST' },
    );
    expect(res.status).toBe(200);
  });

  it('leaves read requests available while denying an invalid mutation role', async () => {
    const app = new Hono<Bindings>();
    app.use('*', async (c, next) => {
      c.set('userId', 'user-1');
      c.set('orgId', 'org-1');
      c.set('role', null);
      return await requireMutationRole('owner', 'manager', 'operator')(c, next);
    });
    app.get('/read', (c) => c.json({ ok: true }));
    app.post('/mutate', (c) => c.json({ ok: true }));

    expect((await app.request('/read')).status).toBe(200);
    expect((await app.request('/mutate', { method: 'POST' })).status).toBe(403);
  });
});
