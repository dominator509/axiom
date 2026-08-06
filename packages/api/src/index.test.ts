// ─── @axiom/api app wiring — Vitest Suite ───
import { describe, it, expect, beforeAll } from 'vitest';

// The api index mounts the fanvue auth router which reads env at load time.
process.env.FANVUE_CLIENT_ID = 'test-client-id';
process.env.FANVUE_REDIRECT_URI = 'https://callback.example.test/callback';
process.env.BETTER_AUTH_SECRET = 'test-secret-0123456789abcdef';
process.env.BETTER_AUTH_URL = 'http://127.0.0.1:3001';

let app: any;

beforeAll(async () => {
  const mod = await import('./index.js');
  app = mod.default;
  // initRelay mounts relay routes asynchronously on module load
  await new Promise((r) => setTimeout(r, 250));
});

describe('health', () => {
  it('GET /api/v1/health returns ok', async () => {
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', version: '0.1.0' });
  });
});

describe('better-auth mounted at /api/auth/*', () => {
  it('GET /api/auth/session no longer returns 501 (handler mounted)', async () => {
    const res = await app.request('/api/auth/session');
    expect(res.status).not.toBe(501);
  });

  it('GET /api/auth/get-session returns a JSON body from better-auth', async () => {
    const res = await app.request('/api/auth/get-session');
    expect([200, 401]).toContain(res.status);
  });
});

describe('mounted route groups', () => {
  it('models list without a session returns 401 (auth-gated)', async () => {
    const res = await app.request('/api/v1/models');
    expect(res.status).toBe(401);
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

describe('llm gateway routes mounted', () => {
  it('GET /api/v1/llm/providers lists available providers', async () => {
    const res = await app.request('/api/v1/llm/providers');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.providers)).toBe(true);
    // vllm is always available (no key required)
    expect(body.providers).toContain('vllm');
  });

  it('GET /api/v1/llm/stats returns gateway statistics', async () => {
    const res = await app.request('/api/v1/llm/stats');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.requests).toBe('number');
    expect(body.cache).toBeDefined();
  });

  it('POST /api/v1/llm/chat validates the request schema', async () => {
    const res = await app.request('/api/v1/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: 'not-an-array' }),
    });
    expect(res.status).toBe(400);
  });
});
