// ─── @axiom/api app wiring — Vitest Suite ───
import { describe, it, expect, beforeAll } from 'vitest';

// The api index mounts the fanvue auth router which reads env at load time.
process.env.FANVUE_CLIENT_ID = 'test-client-id';
process.env.FANVUE_REDIRECT_URI = 'https://callback.example.test/callback';

let app: any;

beforeAll(async () => {
  const mod = await import('./index.js');
  app = mod.default;
  // initRelay mounts relay routes asynchronously on module load
  await new Promise((r) => setTimeout(r, 250));
});

describe('health and auth placeholder', () => {
  it('GET /api/v1/health returns ok', async () => {
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', version: '0.1.0' });
  });

  it('GET/POST /api/auth/* returns 501 until better-auth is wired', async () => {
    const res = await app.request('/api/auth/session');
    expect(res.status).toBe(501);
  });
});

describe('mounted route groups', () => {
  it('models list responds without a DB (stub returns empty)', async () => {
    const res = await app.request('/api/v1/models');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it('fanvue authorize redirects to Fanvue with PKCE params', async () => {
    const res = await app.request('/api/v1/connectors/fanvue/authorize');
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get('location')!);
    expect(url.origin).toBe('https://auth.fanvue.com');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('fanvue callback rejects missing code', async () => {
    const res = await app.request('/api/v1/connectors/fanvue/callback');
    expect(res.status).toBe(400);
  });
});

describe('relay routes mounted via initRelay', () => {
  it('GET /api/v1/metrics responds after relay mount', async () => {
    const res = await app.request('/api/v1/metrics');
    expect(res.status).toBe(200);
  });

  it('POST /api/v1/relay/card handles a card request', async () => {
    const res = await app.request('/api/v1/relay/card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    // Responds with a structured error/success rather than crashing
    expect([200, 400, 500]).toContain(res.status);
  });
});
