import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

let relay: { request: (input: string, init?: RequestInit) => Response | Promise<Response> };

beforeAll(async () => {
  vi.stubEnv('FANVUE_CLIENT_ID', 'test-client-id');
  vi.stubEnv('FANVUE_REDIRECT_URI', 'https://callback.example.test/callback');
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-0123456789abcdef');
  vi.stubEnv('BETTER_AUTH_URL', 'http://127.0.0.1:3001');
  vi.stubEnv('BLUEBUBBLES_URL', 'https://bluebubbles.example');
  vi.stubEnv('BLUEBUBBLES_PASSWORD', 'bb-password');
  vi.stubEnv('BLUEBUBBLES_WEBHOOK_SECRET', 'relay-webhook-secret');

  const mod = await import('./index.js');
  relay = mod.createRelayApp();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('BlueBubbles relay webhook', () => {
  it('rejects requests without the configured webhook secret', async () => {
    const response = await relay.request('/webhooks/imessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'new-message' }),
    });
    expect(response.status).toBe(401);
  });

  it('accepts authenticated non-command events without invoking the domain executor', async () => {
    const response = await relay.request('/webhooks/imessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Axiom-Relay-Secret': 'relay-webhook-secret',
      },
      body: JSON.stringify({ type: 'message-updated', data: {} }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, handled: false });
  });
});
