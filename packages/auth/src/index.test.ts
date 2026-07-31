// ─── @axiom/auth — Vitest Suite ───
import { describe, it, expect, beforeAll } from 'vitest';

// The auth module creates a pg.Pool at import time but does not connect until
// a query runs — a fake DATABASE_URL keeps construction safe and offline.
process.env.DATABASE_URL = 'postgres://test-user@localhost:5432/axiom_test';

let auth: any;

beforeAll(async () => {
  const mod = await import('./index.js');
  auth = mod.auth;
});

describe('better-auth configuration', () => {
  it('exports a configured auth instance', () => {
    expect(auth).toBeDefined();
    expect(typeof auth.handler).toBe('function');
    expect(typeof auth.api).toBe('object');
  });

  it('disables email/password authentication', () => {
    expect(auth.options?.emailAndPassword?.enabled).toBe(false);
  });

  it('enables magic-link authentication', () => {
    expect(auth.options?.magicLinks?.enabled).toBe(true);
  });

  it('enables the organization plugin', () => {
    expect(auth.options?.organization?.enabled).toBe(true);
  });

  it('exposes the runtime context and error codes', () => {
    expect(auth.$context).toBeDefined();
    expect(auth.$ERROR_CODES).toBeDefined();
  });

  it('exposes a handler that serves the auth UI', async () => {
    const res = await auth.handler(new Request('http://localhost/api/auth/error'));
    expect(res.status).toBe(200);
    expect((res.headers.get('content-type') || '').toLowerCase()).toContain('text/html');
  });
});
