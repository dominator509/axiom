// ─── LLM Gateway HTTP routes (Hono) — Vitest Suite ───
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createRouter } from './routes.js';
import type { LLMGateway } from './gateway.js';

function makeGatewayStub() {
  return {
    chat: vi.fn(async () => ({
      id: 'id-1',
      content: 'hello',
      model: 'model-1',
      provider: 'openai',
      cost: 0.001,
      tokens: { prompt: 10, completion: 5, total: 15 },
      latency: 3,
      cached: false,
    })),
    chatStream: vi.fn(async () =>
      (async function* () {
        yield 'chunk-1';
        yield 'chunk-2';
      })(),
    ),
    getAvailableProviders: vi.fn(() => ['openai', 'vllm']),
    getProviderCapabilities: vi.fn(() => [
      {
        provider: 'openai',
        available: true,
        transport: 'user-subscription',
        auth: 'oauth',
        operatorApiCost: false,
        reason: null,
      },
      {
        provider: 'vllm',
        available: true,
        transport: 'local',
        auth: 'none',
        operatorApiCost: false,
        reason: null,
      },
    ]),
    getSubscriptionStatus: vi.fn(async (provider: string) => ({ provider, connected: true })),
    connectSubscription: vi.fn(() =>
      (async function* () {
        yield 'Continue in your browser';
      })(),
    ),
    disconnectSubscription: vi.fn(async () => undefined),
    getStats: vi.fn(() => ({
      requests: 4,
      failures: 1,
      cache: { hits: 2, misses: 3, size: 1 },
    })),
  } as unknown as LLMGateway;
}

function authenticatedApp(gateway: LLMGateway) {
  const app = new Hono<{ Variables: { userId: string; orgId: string } }>();
  app.use('*', async (c, next) => {
    c.set('userId', 'user-route-test');
    c.set('orgId', 'org-route-test');
    await next();
  });
  app.route('/', createRouter(gateway));
  return app;
}

const validBody = {
  messages: [{ role: 'user', content: 'hi' }],
  model: 'model-1',
  temperature: 0.5,
  maxTokens: 100,
  policy: 'cost',
  provider: 'openai',
};

describe('createRouter — POST /chat', () => {
  // POST /chat — non-streaming completion
  it('returns a structured JSON error when the provider call fails', async () => {
    const gateway = makeGatewayStub();
    gateway.chat = vi.fn().mockRejectedValue(new Error('OPENAI_API_KEY not set'));
    const app = createRouter(gateway);

    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { detail: string; status: number; title: string };
    expect(body.detail).toBe('The requested LLM provider could not complete the request');
    expect(body.detail).not.toContain('OPENAI_API_KEY');
    expect(body.status).toBe(502);
    expect(body.title).toBe('Bad Gateway');
  });

  it('returns the chat result for a valid request', async () => {
    const gateway = makeGatewayStub();
    const app = createRouter(gateway);

    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ content: 'hello', provider: 'openai', cached: false });
    expect(gateway.chat).toHaveBeenCalledWith(
      [{ role: 'user', content: 'hi' }],
      expect.objectContaining({
        model: 'model-1',
        temperature: 0.5,
        maxTokens: 100,
        policy: 'cost',
        provider: 'openai',
      }),
    );
  });

  it('works with a minimal body (messages only)', async () => {
    const gateway = makeGatewayStub();
    const app = createRouter(gateway);
    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(200);
    expect(gateway.chat).toHaveBeenCalledWith(
      [{ role: 'user', content: 'hi' }],
      expect.objectContaining({ model: undefined, temperature: undefined }),
    );
  });

  it('forwards the egress flag to the gateway (L2.6 egress routing)', async () => {
    const gateway = makeGatewayStub();
    const app = createRouter(gateway);
    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], egress: true }),
    });
    expect(res.status).toBe(200);
    expect(gateway.chat).toHaveBeenCalledWith(
      [{ role: 'user', content: 'hi' }],
      expect.objectContaining({ egress: true }),
    );
  });

  it('forwards egress:false as false (not undefined) for stream', async () => {
    const gateway = makeGatewayStub();
    const app = createRouter(gateway);
    const res = await app.request('/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], egress: false }),
    });
    expect(res.status).toBe(200);
    expect(gateway.chatStream).toHaveBeenCalledWith(
      [{ role: 'user', content: 'hi' }],
      expect.objectContaining({ egress: false }),
    );
  });

  it('accepts an empty messages array (source gap: schema has no min(1))', async () => {
    const gateway = makeGatewayStub();
    const app = createRouter(gateway);
    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    });
    // The chatBodySchema does not enforce a minimum message count, so an
    // empty array passes validation and reaches the gateway. Documented as a
    // validation gap; asserting the real behavior here.
    expect(res.status).toBe(200);
    expect(gateway.chat).toHaveBeenCalledWith([], expect.anything());
  });

  it('rejects messages with an invalid role', async () => {
    const gateway = makeGatewayStub();
    const app = createRouter(gateway);
    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'admin', content: 'x' }] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects non-string message content', async () => {
    const gateway = makeGatewayStub();
    const app = createRouter(gateway);
    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 42 }] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects temperature out of [0,2] range', async () => {
    const gateway = makeGatewayStub();
    const app = createRouter(gateway);
    for (const temperature of [-0.1, 2.5]) {
      const res = await app.request('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validBody, temperature }),
      });
      expect(res.status).toBe(400);
    }
  });

  it('rejects non-positive or non-integer maxTokens', async () => {
    const gateway = makeGatewayStub();
    const app = createRouter(gateway);
    for (const maxTokens of [0, -5, 3.5, 'lots']) {
      const res = await app.request('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validBody, maxTokens }),
      });
      expect(res.status).toBe(400);
    }
  });

  it('rejects an invalid policy value', async () => {
    const gateway = makeGatewayStub();
    const app = createRouter(gateway);
    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, policy: 'cheapest' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing JSON body', async () => {
    const gateway = makeGatewayStub();
    const app = createRouter(gateway);
    const res = await app.request('/chat', { method: 'POST' });
    expect(res.status).toBe(400);
  });
});

describe('createRouter — POST /chat/stream', () => {
  it('streams SSE data lines followed by [DONE]', async () => {
    const gateway = makeGatewayStub();
    const app = createRouter(gateway);

    const res = await app.request('/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');

    const text = await res.text();
    expect(text).toContain('data: {"content":"chunk-1"}');
    expect(text).toContain('data: {"content":"chunk-2"}');
    expect(text).toContain('data: [DONE]');
  });

  it('emits an error event when the stream throws', async () => {
    const gateway = makeGatewayStub();
    gateway.chatStream = vi.fn(async () => {
      throw new Error('stream broke');
    });
    const app = createRouter(gateway);

    const res = await app.request('/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const text = await res.text();
    expect(text).toContain('event: error');
    expect(text).toContain('The requested LLM provider could not complete the stream');
    expect(text).not.toContain('stream broke');
    expect(text).not.toContain('data: [DONE]');
  });

  it('rejects an invalid body with 400 before streaming', async () => {
    const gateway = makeGatewayStub();
    const app = createRouter(gateway);
    const res = await app.request('/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: 'nope' }),
    });
    expect(res.status).toBe(400);
    expect(gateway.chatStream).not.toHaveBeenCalled();
  });
});

describe('createRouter — GET endpoints', () => {
  it('GET /providers returns the available provider list', async () => {
    const gateway = makeGatewayStub();
    const app = createRouter(gateway);
    const res = await app.request('/providers');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ providers: ['openai', 'vllm'] });
  });

  it('GET /stats returns gateway statistics', async () => {
    const gateway = makeGatewayStub();
    const app = createRouter(gateway);
    const res = await app.request('/stats');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      requests: 4,
      failures: 1,
      cache: { hits: 2, misses: 3, size: 1 },
    });
  });

  it('returns 404 for unknown routes', async () => {
    const gateway = makeGatewayStub();
    const app = createRouter(gateway);
    const res = await app.request('/nope');
    expect(res.status).toBe(404);
  });
});

describe('createRouter — subscription OAuth lifecycle', () => {
  it('reports connection state for the authenticated user', async () => {
    const gateway = makeGatewayStub();
    const res = await authenticatedApp(gateway).request('/subscriptions/grok');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ provider: 'grok', connected: true });
    expect(gateway.getSubscriptionStatus).toHaveBeenCalledWith('grok', 'user-route-test');
  });

  it('streams provider login instructions without caching', async () => {
    const gateway = makeGatewayStub();
    const res = await authenticatedApp(gateway).request('/subscriptions/openai/login', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toContain('event: connected');
    expect(gateway.connectSubscription).toHaveBeenCalledWith(
      'openai',
      'user-route-test',
      expect.any(AbortSignal),
    );
  });

  it('disconnects only the authenticated user profile', async () => {
    const gateway = makeGatewayStub();
    const res = await authenticatedApp(gateway).request('/subscriptions/anthropic', {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ provider: 'anthropic', connected: false });
    expect(gateway.disconnectSubscription).toHaveBeenCalledWith('anthropic', 'user-route-test');
  });

  it('rejects providers without a qualifying subscription transport', async () => {
    const gateway = makeGatewayStub();
    const res = await authenticatedApp(gateway).request('/subscriptions/deepseek');
    expect(res.status).toBe(404);
  });
});
