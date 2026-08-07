// ─── LLMGateway — Vitest Suite ───
// Mocks global fetch and exercises the real provider wrappers end-to-end.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LLMGateway } from './gateway.js';
import type { Message } from './gateway.js';

const ENV_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'DEEPSEEK_API_KEY',
  'GROK_API_KEY',
  'MISTRAL_API_KEY',
  'LIGHTNING_API_KEY',
  'GOOGLE_API_KEY',
  'VENICE_API_KEY',
  'OPENAI_BASE_URL',
  'VENICE_BASE_URL',
  'VLLM_BASE_URL',
];

// getEnvVar() falls back to the lower-case spelling, so tests must clean both.
function clearAllKeys() {
  for (const k of ENV_KEYS) delete process.env[k];
  for (const k of ENV_KEYS) delete process.env[k.toLowerCase()];
}

const messages: Message[] = [
  { role: 'system', content: 'be helpful' },
  { role: 'user', content: 'hello there' },
];

const openaiCompletion = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 1,
  model: 'gpt-4o',
  choices: [
    { index: 0, message: { role: 'assistant', content: 'hello from openai' }, finish_reason: 'stop' },
  ],
  usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
};

const deepseekCompletion = {
  id: 'deepseek-1',
  object: 'chat.completion',
  created: 1,
  model: 'deepseek-chat',
  choices: [
    { index: 0, message: { role: 'assistant', content: 'hello from deepseek' }, finish_reason: 'stop' },
  ],
  usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
};

const grokCompletion = {
  id: 'grok-1',
  object: 'chat.completion',
  created: 1,
  model: 'grok-2-latest',
  choices: [
    { index: 0, message: { role: 'assistant', content: 'hello from grok' }, finish_reason: 'stop' },
  ],
  usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
};

const veniceCompletion = {
  id: 'venice-1',
  object: 'chat.completion',
  created: 1,
  model: 'llama-3.1-70b',
  choices: [
    { index: 0, message: { role: 'assistant', content: 'hello from venice' }, finish_reason: 'stop' },
  ],
  usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
};

const vllmCompletion = {
  id: 'vllm-1',
  object: 'chat.completion',
  created: 1,
  model: 'local-model',
  choices: [
    { index: 0, message: { role: 'assistant', content: 'hello from vllm' }, finish_reason: 'stop' },
  ],
  usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
};

const anthropicResponse = {
  id: 'msg-1',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'hello from anthropic' }],
  model: 'claude-3-5-sonnet-latest',
  stop_reason: 'end_turn',
  usage: { input_tokens: 50, output_tokens: 10 },
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line + '\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

let fetchMock: ReturnType<typeof vi.fn>;

function setAllKeys() {
  clearAllKeys();
  for (const k of [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'DEEPSEEK_API_KEY',
    'GROK_API_KEY',
    'MISTRAL_API_KEY',
    'LIGHTNING_API_KEY',
    'GOOGLE_API_KEY',
    'VENICE_API_KEY',
  ]) {
    process.env[k] = 'test-key-123';
  }
}

beforeEach(() => {
  setAllKeys();
  fetchMock = vi.fn(async (url: string) => {
    if (url.includes('api.openai.com')) return jsonResponse(openaiCompletion);
    if (url.includes('api.anthropic.com')) return jsonResponse(anthropicResponse);
    if (url.includes('api.deepseek.com')) return jsonResponse(deepseekCompletion);
    if (url.includes('api.x.ai')) return jsonResponse(grokCompletion);
    if (url.includes('api.venice.ai')) return jsonResponse(veniceCompletion);
    if (url.includes('localhost:8000')) return jsonResponse(vllmCompletion);
    return jsonResponse({ error: 'unexpected url' }, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearAllKeys();
  vi.useRealTimers();
});

describe('LLMGateway — availability and selection', () => {
  it('lists all providers when all API keys are set', () => {
    const gw = new LLMGateway();
    expect(gw.getAvailableProviders().sort()).toEqual([
      'anthropic', 'deepseek', 'google', 'grok', 'lightning', 'mistral',
      'openai', 'venice', 'vllm',
    ]);
  });

  it('lists only vllm when no API keys are set', () => {
    clearAllKeys();
    const gw = new LLMGateway();
    expect(gw.getAvailableProviders()).toEqual(['vllm']);
  });

  it('reads env vars case-insensitively (lowercase fallback)', () => {
    delete process.env.OPENAI_API_KEY;
    process.env.openai_api_key = 'lowercase-key-456';
    const gw = new LLMGateway();
    expect(gw.getAvailableProviders()).toContain('openai');
  });

  it('throws when explicit provider is unknown', async () => {
    const gw = new LLMGateway();
    await expect(gw.chat(messages, { provider: 'nope' })).rejects.toThrow('Unknown provider: nope');
  });

  it('throws when no providers are available', async () => {
    clearAllKeys();
    const gw = new LLMGateway([{ name: 'vllm', requiresKey: true }]);
    await expect(gw.chat(messages)).rejects.toThrow(
      'No providers available — set at least one API key',
    );
  });

  it('merges custom provider overrides and adds new providers', () => {
    const gw = new LLMGateway([
      { name: 'custom-box', apiKeyEnv: 'CUSTOM_KEY', baseUrl: 'http://custom.test', defaultModel: 'custom-model', requiresKey: false },
      { name: 'openai', rpm: 7 },
    ]);
    const avail = gw.getAvailableProviders();
    expect(avail).toContain('custom-box');
    expect(avail).toContain('openai');
  });

  it('exposes cache, pipeline and stats accessors', () => {
    const gw = new LLMGateway();
    expect(gw.getCache()).toBeDefined();
    expect(gw.getPipeline()).toBeDefined();
    expect(gw.getStats()).toEqual({
      requests: 0,
      failures: 0,
      cache: { hits: 0, misses: 0, size: 0 },
      tokenkiller: { hits: 0, misses: 0, ratio: 0, size: 0, capacity: 1000 },
    });
  });
});

describe('LLMGateway.chat — happy paths', () => {
  it('calls the explicit openai provider and returns a ChatResult', async () => {
    const gw = new LLMGateway();
    const result = await gw.chat(messages, { provider: 'openai', model: 'model-1' });

    expect(result.content).toBe('hello from openai');
    expect(result.model).toBe('model-1');
    expect(result.provider).toBe('openai');
    expect(result.cached).toBe(false);
    expect(result.cost).toBeCloseTo(0.0005, 8); // 100*0.0025/1K + 25*0.01/1K
    expect(result.tokens).toEqual({ prompt: 100, completion: 25, total: 125 });
    expect(typeof result.id).toBe('string');
    expect(result.id.length).toBeGreaterThan(0);
    expect(result.latency).toBeGreaterThanOrEqual(0);

    // fetch called once against the openai endpoint with the right payload
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-key-123',
    });
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('model-1');
    expect(body.messages).toEqual(messages);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(4096);
  });

  it('passes through temperature and maxTokens options', async () => {
    const gw = new LLMGateway();
    await gw.chat(messages, { provider: 'openai', temperature: 0.2, maxTokens: 123 });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(123);
  });

  it('falls back to the provider defaultModel when no model is given', async () => {
    const gw = new LLMGateway();
    const result = await gw.chat(messages, { provider: 'deepseek' });
    // An absent model becomes '' in chat(), which is falsy — callProvider's
    // `options.model || provider.defaultModel` then applies the default.
    expect(result.model).toBe('deepseek-v4-flash');
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('deepseek-v4-flash');
  });

  it('routes to anthropic with system message extraction', async () => {
    const gw = new LLMGateway();
    const result = await gw.chat(messages, { provider: 'anthropic' });

    expect(result.content).toBe('hello from anthropic');
    expect(result.tokens).toEqual({ prompt: 50, completion: 10, total: 60 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers).toMatchObject({
      'x-api-key': 'test-key-123',
      'anthropic-version': '2023-06-01',
    });
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe('be helpful');
    expect(body.messages).toEqual([{ role: 'user', content: 'hello there' }]);
    expect(body.max_tokens).toBe(4096);
  });

  it('routes to deepseek', async () => {
    const gw = new LLMGateway();
    const result = await gw.chat(messages, { provider: 'deepseek' });
    expect(result.content).toBe('hello from deepseek');
    expect(result.cost).toBeCloseTo(0.00125, 8); // 1000*0.0005/1K + 500*0.0015/1K
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepseek.com/v1/chat/completions');
  });

  it('routes to grok', async () => {
    const gw = new LLMGateway();
    const result = await gw.chat(messages, { provider: 'grok' });
    expect(result.content).toBe('hello from grok');
    expect(result.cost).toBeCloseTo(0.006, 8);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.x.ai/v1/chat/completions');
  });

  it('routes to venice', async () => {
    const gw = new LLMGateway();
    const result = await gw.chat(messages, { provider: 'venice' });
    expect(result.content).toBe('hello from venice');
    expect(result.cost).toBeCloseTo(0.00135, 8);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.venice.ai/api/v1/chat/completions');
  });

  it('routes to vllm without requiring an API key', async () => {
    clearAllKeys();
    const gw = new LLMGateway();
    // Pass an explicit model to sidestep the empty-model quirk above.
    const result = await gw.chat(messages, { model: 'local-model' });
    expect(result.provider).toBe('vllm');
    expect(result.model).toBe('local-model');
    expect(result.content).toBe('hello from vllm');
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8000/v1/chat/completions');
  });

  it('selects the cheapest available provider under cost policy', async () => {
    // vllm (cost 0) should win over all paid providers
    const gw = new LLMGateway();
    const result = await gw.chat(messages, { policy: 'cost' });
    expect(result.provider).toBe('vllm');
  });

  it('selects the lowest-latency provider under latency policy', async () => {
    // vllm has latencyRank 1 -> first; it succeeds so no fallback happens
    const gw = new LLMGateway();
    const result = await gw.chat(messages, { policy: 'latency' });
    expect(result.provider).toBe('vllm');
  });

  it('selects the highest-quality provider under quality policy', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('api.openai.com')) return jsonResponse(openaiCompletion);
      return jsonResponse(vllmCompletion);
    });
    const gw = new LLMGateway();
    const result = await gw.chat(messages, { policy: 'quality' });
    // openai and anthropic both rank 5; insertion order puts openai first
    expect(result.provider).toBe('openai');
  });

  it('honors an explicit provider even when another would win the policy sort', async () => {
    const gw = new LLMGateway();
    const result = await gw.chat(messages, { policy: 'cost', provider: 'grok' });
    expect(result.provider).toBe('grok');
  });
});

describe('LLMGateway.chat — cache', () => {
  it('returns a cached response without calling the provider', async () => {
    const gw = new LLMGateway();
    gw.getCache().set('model-1', { content: 'cached-1', usage: { prompt: 9, completion: 9 } });

    const result = await gw.chat(messages, { model: 'model-1' });
    expect(result.cached).toBe(true);
    expect(result.provider).toBe('cache');
    expect(result.content).toBe('cached-1');
    expect(result.cost).toBe(0);
    expect(result.tokens).toEqual({ prompt: 0, completion: 0, total: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(gw.getStats().cache.hits).toBe(1);
  });

  it('misses the cache and calls the provider when key absent', async () => {
    const gw = new LLMGateway();
    const result = await gw.chat(messages, { model: 'model-1' });
    expect(result.cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(gw.getStats().cache.misses).toBe(1);
  });

  it('skips the cache lookup when no model is given', async () => {
    const gw = new LLMGateway();
    gw.getCache().set('', { content: 'cached-empty', usage: { prompt: 1, completion: 1 } });
    const result = await gw.chat(messages);
    expect(result.cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stores the provider result in the cache after a successful call', async () => {
    const gw = new LLMGateway();
    await gw.chat(messages, { provider: 'openai', model: 'model-1' });
    const stats = gw.getCache().stats();
    expect(stats.size).toBe(1);
    // NOTE: cache SET key is `${JSON.stringify(messages)}::${model}` while the
    // chat() GET key is just `${model}` — they never match, so a follow-up
    // identical request misses. Documented as a source quirk (see report).
    const second = await gw.chat(messages, { provider: 'openai', model: 'model-1' });
    expect(second.cached).toBe(false);
    expect(gw.getStats().cache.hits).toBe(0);
  });
});

describe('LLMGateway.chat — failures, retries, fallback', () => {
  it('retries a transient provider error and succeeds on the second attempt', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('transient network blip'))
      .mockImplementation(async (url: string) => {
        if (url.includes('api.openai.com')) return jsonResponse(openaiCompletion);
        return jsonResponse(vllmCompletion);
      });

    const gw = new LLMGateway();
    vi.useFakeTimers();
    const promise = gw.chat(messages, { provider: 'openai' });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    vi.useRealTimers();

    expect(result.content).toBe('hello from openai');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(gw.getStats().failures).toBe(1);
    expect(gw.getStats().requests).toBe(1);
  });

  it('falls back to vllm when the primary provider aborts (no retry on abort)', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('api.openai.com')) throw new DOMException('aborted by user', 'AbortError');
      if (url.includes('localhost:8000')) return jsonResponse(vllmCompletion);
      return jsonResponse({ error: 'unexpected' }, 500);
    });

    const gw = new LLMGateway();
    const result = await gw.chat(messages, { provider: 'openai' });
    expect(result.provider).toBe('vllm');
    expect(result.content).toBe('hello from vllm');
    expect(gw.getStats().failures).toBe(1);
  });

  it('exhausts retries and throws the last provider error', async () => {
    fetchMock.mockRejectedValue(new Error('permanent outage'));

    const gw = new LLMGateway();
    vi.useFakeTimers();
    const promise = gw.chat(messages, { provider: 'openai' });
    promise.catch(() => {}); // mark handled to avoid unhandled-rejection noise
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(promise).rejects.toThrow('permanent outage');
    vi.useRealTimers();

    // 4 attempts per provider (initial + 3 retries) * 2 providers
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(gw.getStats().failures).toBe(8);
  });

  it('aggregates every chain failure and surfaces the primary provider first', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    const gw = new LLMGateway();
    vi.useFakeTimers();
    const promise = gw.chat(messages, { provider: 'openai' });
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(promise).rejects.toThrow(/All providers in the fallback chain failed — openai: boom; vllm: boom/);
    vi.useRealTimers();
  });

  it('is rate limited when the bucket is empty (chat path throws after retries)', async () => {
    const gw = new LLMGateway([{ name: 'openai', rpm: 0 }, { name: 'vllm', rpm: 0 }]);
    vi.useFakeTimers();
    const promise = gw.chat(messages, { provider: 'openai' });
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(promise).rejects.toThrow('Rate limit exceeded for vllm');
    vi.useRealTimers();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs pipeline after-hooks on the result', async () => {
    const gw = new LLMGateway();
    gw.getPipeline().use({
      name: 'wrap',
      after: async (r) => ({ ...r, content: r.content + '-wrapped' }),
    });
    const result = await gw.chat(messages, { provider: 'openai' });
    expect(result.content).toBe('hello from openai-wrapped');
  });
});

describe('LLMGateway.chatStream', () => {
  const streamLines = [
    'data: {"choices":[{"delta":{"content":"chunk-a"}}]}',
    'data: {"choices":[{"delta":{"content":"chunk-b"}}]}',
    'data: [DONE]',
  ];

  it('yields chunks from the streamed provider and caches the full response', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('api.openai.com')) return sseResponse(streamLines);
      return jsonResponse(vllmCompletion);
    });

    const gw = new LLMGateway();
    const stream = await gw.chatStream(messages, { provider: 'openai', model: 'model-1' });
    const chunks: string[] = [];
    for await (const chunk of stream) chunks.push(chunk);

    expect(chunks).toEqual(['chunk-a', 'chunk-b']);
    expect(gw.getStats().requests).toBe(1);
    expect(gw.getCache().stats().size).toBe(1);
  });

  it('falls back to the next provider when the first fails', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('api.openai.com')) throw new Error('stream exploded');
      if (url.includes('localhost:8000')) return sseResponse(streamLines);
      return jsonResponse(vllmCompletion);
    });

    const gw = new LLMGateway();
    const stream = await gw.chatStream(messages, { provider: 'openai' });
    const chunks: string[] = [];
    for await (const chunk of stream) chunks.push(chunk);

    expect(chunks).toEqual(['chunk-a', 'chunk-b']);
    expect(gw.getStats().failures).toBe(1);
  });

  it('skips a rate-limited provider and uses the next one', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('localhost:8000')) return sseResponse(streamLines);
      return jsonResponse(vllmCompletion);
    });

    const gw = new LLMGateway([{ name: 'openai', rpm: 0 }]);
    const stream = await gw.chatStream(messages, { provider: 'openai' });
    const chunks: string[] = [];
    for await (const chunk of stream) chunks.push(chunk);

    expect(chunks).toEqual(['chunk-a', 'chunk-b']);
    expect(gw.getStats().failures).toBe(1);
  });

  it('consumes a rate limit token on success (rpm 1 allows one call)', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('api.openai.com')) return sseResponse(streamLines);
      if (url.includes('localhost:8000')) return sseResponse(['data: [DONE]']);
      return jsonResponse(vllmCompletion);
    });

    const gw = new LLMGateway([{ name: 'openai', rpm: 1 }]);
    const first = await gw.chatStream(messages, { provider: 'openai' });
    for await (const _ of first) { /* drain */ }
    expect(gw.getStats().failures).toBe(0);

    // second call: openai bucket empty -> falls back to vllm
    const second = await gw.chatStream(messages, { provider: 'openai' });
    for await (const _ of second) { /* drain */ }
    expect(gw.getStats().failures).toBe(1);
  });

  it('propagates abort errors without falling back', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('api.openai.com')) throw new DOMException('stream aborted', 'AbortError');
      if (url.includes('localhost:8000')) return sseResponse(streamLines);
      return jsonResponse(vllmCompletion);
    });

    const gw = new LLMGateway();
    const stream = await gw.chatStream(messages, { provider: 'openai' });
    const collect = async () => {
      const out: string[] = [];
      for await (const chunk of stream) out.push(chunk);
      return out;
    };
    await expect(collect()).rejects.toThrow('stream aborted');
    // only the openai endpoint was hit — no fallback
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      'https://api.openai.com/v1/chat/completions',
    ]);
  });

  it('throws after all providers in the chain fail', async () => {
    fetchMock.mockRejectedValue(new Error('all streams down'));
    const gw = new LLMGateway();
    const stream = await gw.chatStream(messages, { provider: 'openai' });
    const collect = async () => {
      const out: string[] = [];
      for await (const chunk of stream) out.push(chunk);
      return out;
    };
    await expect(collect()).rejects.toThrow('all streams down');
    expect(gw.getStats().failures).toBe(2);
  });

  it('streams from vllm when it is the only available provider', async () => {
    clearAllKeys();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('localhost:8000')) return sseResponse(streamLines);
      return jsonResponse(vllmCompletion);
    });

    const gw = new LLMGateway();
    const stream = await gw.chatStream(messages);
    const chunks: string[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    expect(chunks).toEqual(['chunk-a', 'chunk-b']);
  });
});

describe('LLMGateway — stats', () => {
  it('accumulates request and failure counts', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('api.openai.com')) return jsonResponse(openaiCompletion);
      return jsonResponse(vllmCompletion);
    });

    const gw = new LLMGateway();
    await gw.chat(messages, { provider: 'openai', model: 'model-1' });
    await gw.chat(messages, { provider: 'openai', model: 'model-1' });

    const stats = gw.getStats();
    expect(stats.requests).toBe(2);
    expect(stats.failures).toBe(0);
    expect(stats.cache.misses).toBe(2);
  });

  it('reports failures for aborted primary attempts', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('api.openai.com')) throw new DOMException('x', 'AbortError');
      if (url.includes('localhost:8000')) return jsonResponse(vllmCompletion);
      return jsonResponse({ error: 'unexpected' }, 500);
    });
    const gw = new LLMGateway();
    await gw.chat(messages, { provider: 'openai' });
    expect(gw.getStats().failures).toBe(1);
  });
});
