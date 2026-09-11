// ─── @axiom/api app wiring — Vitest Suite ───
import { describe, it, expect, beforeAll, vi } from 'vitest';

// The api index mounts the fanvue auth router which reads env at load time.
process.env.FANVUE_CLIENT_ID = 'test-client-id';
process.env.FANVUE_REDIRECT_URI = 'https://callback.example.test/callback';
process.env.BETTER_AUTH_SECRET = 'test-secret-0123456789abcdef';
process.env.BETTER_AUTH_URL = 'http://127.0.0.1:3001';

let app: any;
let createRelayApp: (() => any) | undefined;

beforeAll(async () => {
  const mod = await import('./index.js');
  app = mod.default;
  createRelayApp = mod.createRelayApp;
  // initRelay mounts relay routes asynchronously on module load
  await new Promise((r) => setTimeout(r, 250));
});

describe('health', () => {
  it('GET /api/v1/health returns ok', async () => {
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', version: '0.1.0' });
  });

  it('GET /api/v1/openapi.json serves the build-time OpenAPI doc (L3.0)', async () => {
    const res = await app.request('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.openapi).toBe('3.0.3');
    expect(body.paths).toBeDefined();
    expect(typeof body.paths).toBe('object');
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

  it('rate-limits repeated auth requests', async () => {
    const headers = { 'X-API-Key': 'auth-rate-limit-test' };
    let last: Response | undefined;
    for (let attempt = 0; attempt < 21; attempt += 1) {
      last = await app.request('/api/auth/get-session', { headers });
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get('Retry-After')).toBeTruthy();
  });
});

describe('mounted route groups', () => {
  // Mirror the server client's existing operations, not just router-local paths.
  // Normalize parameter names: :id and :modelId describe the same URL shape.
  it.each([
    ['GET', '/models'], ['POST', '/models'], ['GET', '/models/stats/count'],
    ['GET', '/models/:id'], ['GET', '/models/:id/network'],
    ['GET', '/models/:id/network/health'], ['PUT', '/models/:id/network'],
    ['GET', '/models/:id/calendar'], ['GET', '/models/:id/fans'],
    ['GET', '/models/:id/custom-requests'], ['GET', '/models/:id/analytics'],
    ['GET', '/models/:id/viral'], ['GET', '/models/:id/playbook-score'],
    ['POST', '/models/:id/generate'], ['GET', '/models/:id/linkbio'],
    ['POST', '/models/:id/linkbio'], ['DELETE', '/models/:id/linkbio/:kind'],
    ['GET', '/models/:id/linkbio/analytics'], ['GET', '/bundles'],
    ['GET', '/bundles/:id'], ['POST', '/bundles/:id/approve'],
    ['POST', '/bundles/:id/revise'], ['POST', '/bundles/:id/reject'],
    ['GET', '/killswitch'], ['POST', '/killswitch/enable'], ['POST', '/killswitch/disable'],
    ['GET', '/audit'], ['GET', '/audit/verify'], ['GET', '/incidents'],
    ['POST', '/incidents/:id/replay'], ['GET', '/social-accounts'], ['GET', '/llm/providers'],
  ])('mounts the dashboard contract %s %s', (method, path) => {
    const normalize = (value: string) => value.replace(/:[^/]+/g, ':param');
    const paths = app.routes
      .filter((route: { method: string }) => route.method === method)
      .map((route: { path: string }) => normalize(route.path));
    expect(paths).toContain(normalize(`/api/v1${path}`));
  });

  it('mounts network handlers at the documented model-scoped paths', () => {
    const routes = app.routes.map((route: { method: string; path: string }) => `${route.method} ${route.path}`);
    expect(routes).toContain('GET /api/v1/models/:modelId/network');
    expect(routes).toContain('PUT /api/v1/models/:modelId/network');
    expect(routes).toContain('GET /api/v1/models/:modelId/network/health');
    expect(routes).not.toContain('PUT /api/v1/:modelId/network');
  });

  it('models list without a session returns 401 (auth-gated)', async () => {
    const res = await app.request('/api/v1/models');
    expect(res.status).toBe(401);
    expect(res.headers.get('Content-Type')).toMatch(/^application\/problem\+json/);
    expect(res.headers.get('X-Correlation-ID')).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });

  it('fanvue authorize requires an authenticated operator session', async () => {
    const res = await app.request('/api/v1/connectors/fanvue/authorize');
    expect(res.status).toBe(401);
  });

  it('fanvue callback rejects missing code', async () => {
    const res = await app.request('/api/v1/connectors/fanvue/callback');
    expect(res.status).toBe(400);
  });

  it('does not reflect an untrusted browser origin', async () => {
    const res = await app.request('/api/v1/health', {
      headers: { Origin: 'https://attacker.example' },
    });
    expect(res.headers.get('access-control-allow-origin')).not.toBe('https://attacker.example');
  });
});

describe('relay routes mounted via initRelay', () => {
  it('GET /api/v1/metrics responds after relay mount', async () => {
    const res = await app.request('/api/v1/metrics');
    expect(res.status).toBe(200);
  });

  it('POST /api/v1/relay/card requires an authenticated operator session', async () => {
    const res = await app.request('/api/v1/relay/card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('mounts and authenticates Telegram webhook delivery when configured', async () => {
    const previousToken = process.env.TELEGRAM_BOT_TOKEN;
    const previousUrl = process.env.TELEGRAM_WEBHOOK_URL;
    const previousSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    process.env.TELEGRAM_BOT_TOKEN = 'test-telegram-token';
    process.env.TELEGRAM_WEBHOOK_URL = 'https://relay.example/webhooks/telegram';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'telegram-test-secret';

    try {
      const relayApp = createRelayApp!();
      const relayModule = await import('@axiom/relay');
      const handleWebhookSpy = vi
        .spyOn(relayModule.TelegramAdapter.prototype, 'handleWebhook')
        .mockResolvedValue(undefined);
      const unauthorized = await relayApp.request('/webhooks/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ update_id: 1 }),
      });
      expect(unauthorized.status).toBe(401);

      const invalidJson = await relayApp.request('/webhooks/telegram', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': 'telegram-test-secret',
        },
        body: '{',
      });
      expect(invalidJson.status).toBe(400);

      const accepted = await relayApp.request('/webhooks/telegram', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': 'telegram-test-secret',
        },
        body: JSON.stringify({ update_id: 1 }),
      });
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toEqual({ ok: true });
      expect(handleWebhookSpy).toHaveBeenCalledWith({ update_id: 1 });

      const oversized = await relayApp.request('/webhooks/telegram', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': 'telegram-test-secret',
        },
        body: `{"payload":"${'x'.repeat(262_144)}"}`,
      });
      expect(oversized.status).toBe(413);
      expect(await oversized.json()).toEqual({ error: 'payload too large' });

      handleWebhookSpy.mockRestore();
    } finally {
      if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
      else process.env.TELEGRAM_BOT_TOKEN = previousToken;
      if (previousUrl === undefined) delete process.env.TELEGRAM_WEBHOOK_URL;
      else process.env.TELEGRAM_WEBHOOK_URL = previousUrl;
      if (previousSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
      else process.env.TELEGRAM_WEBHOOK_SECRET = previousSecret;
    }
  });

  it('rejects malformed Threads webhook JSON without throwing', async () => {
    const previousClientId = process.env.THREADS_CLIENT_ID;
    const previousClientSecret = process.env.THREADS_CLIENT_SECRET;
    process.env.THREADS_CLIENT_ID = 'test-threads-client-id';
    process.env.THREADS_CLIENT_SECRET = 'test-threads-client-secret';

    try {
      const relayApp = createRelayApp!();
      const response = await relayApp.request('/webhooks/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: 'invalid JSON payload' });

      const oversized = await relayApp.request('/webhooks/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: `{"payload":"${'x'.repeat(262_144)}"}`,
      });
      expect(oversized.status).toBe(413);
      await expect(oversized.json()).resolves.toEqual({ error: 'payload too large' });
    } finally {
      if (previousClientId === undefined) delete process.env.THREADS_CLIENT_ID;
      else process.env.THREADS_CLIENT_ID = previousClientId;
      if (previousClientSecret === undefined) delete process.env.THREADS_CLIENT_SECRET;
      else process.env.THREADS_CLIENT_SECRET = previousClientSecret;
    }
  });
});

describe('llm gateway routes mounted', () => {
  it('GET /api/v1/llm/providers requires an authenticated session', async () => {
    const res = await app.request('/api/v1/llm/providers');
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/llm/stats requires an authenticated session', async () => {
    const res = await app.request('/api/v1/llm/stats');
    expect(res.status).toBe(401);
  });

  it('POST /api/v1/llm/chat rejects unauthenticated requests before provider work', async () => {
    const res = await app.request('/api/v1/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: 'not-an-array' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('MCP transport body limits', () => {
  it('rejects an oversized JSON-RPC body before authentication work', async () => {
    const response = await app.request('/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'mcp-body-limit-test',
      },
      body: `{"payload":"${'x'.repeat(262_144)}"}`,
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Request body too large' },
      id: null,
    });
  });

  it('returns a JSON-RPC parse error for malformed bodies', async () => {
    const response = await app.request('/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'mcp-parse-error-test',
      },
      body: '{',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' },
      id: null,
    });
  });
});
