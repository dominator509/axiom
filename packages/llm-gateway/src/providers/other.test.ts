// ─── VeniceProvider / VLLMProvider + deepseek/grok/venice/vllm legacy fns — Vitest Suite ───
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  VeniceProvider,
  callVenice,
  streamVenice,
  VENICE_BASE_URL,
  type VeniceCompletionRequest,
} from './venice.js';
import {
  VLLMProvider,
  callVLLM,
  streamVLLM,
  VLLM_BASE_URL,
  type VLLMCompletionRequest,
} from './vllm.js';
import { callDeepSeek, streamDeepSeek, DEEPSEEK_BASE_URL, type DeepSeekCompletionRequest } from './deepseek.js';
import { callGrok, streamGrok, GROK_BASE_URL, type GrokCompletionRequest } from './grok.js';
import { ProviderError } from './types.js';

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

const openaiStyleCompletion = (content: string, prompt = 100, completion = 40) => ({
  id: 'c-1',
  object: 'chat.completion',
  created: 1,
  model: 'some-model',
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  delete process.env.VENICE_BASE_URL;
  delete process.env.VLLM_BASE_URL;
  fetchMock = vi.fn(async () => jsonResponse(openaiStyleCompletion('hello')));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.VENICE_BASE_URL;
  delete process.env.VLLM_BASE_URL;
});

describe('base URL constants', () => {
  it('exposes the expected endpoints', () => {
    expect(DEEPSEEK_BASE_URL).toBe('https://api.deepseek.com/v1');
    expect(GROK_BASE_URL).toBe('https://api.x.ai/v1');
    expect(VENICE_BASE_URL).toBe('https://api.venice.ai/api/v1');
    expect(VLLM_BASE_URL).toBe('http://localhost:8000/v1');
  });
});

describe('callDeepSeek', () => {
  const req: DeepSeekCompletionRequest = { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] };

  it('calls the deepseek endpoint with bearer auth', async () => {
    const res = await callDeepSeek('ds-key-111', req);
    expect(res.choices[0].message.content).toBe('hello');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer ds-key-111' });
    expect(JSON.parse(init.body as string)).toEqual(req);
  });

  it('throws a plain Error (not ProviderError) on non-ok', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'x' }, 503));
    const err = await callDeepSeek('ds-key-111', req).catch(e => e);
    expect(err).not.toBeInstanceOf(ProviderError);
    expect(err.message).toContain('DeepSeek API error 503');
  });
});

describe('streamDeepSeek', () => {
  const req: DeepSeekCompletionRequest = { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] };

  it('yields deltas and stops at [DONE]', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"a"}}]}',
        'data: {"choices":[{"delta":{"content":"b"}}]}',
        'data: [DONE]',
      ]),
    );
    const chunks: string[] = [];
    for await (const c of streamDeepSeek('ds-key-111', req)) chunks.push(c);
    expect(chunks).toEqual(['a', 'b']);
  });

  it('marks stream=true and throws plain Error on non-ok', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'x' }, 500));
    const err = await (async () => {
      for await (const _ of streamDeepSeek('ds-key-111', req)) { /* drain */ }
    })().catch(e => e);
    expect(err.message).toContain('DeepSeek stream error 500');

    fetchMock.mockResolvedValueOnce(sseResponse(['data: [DONE]']));
    for await (const _ of streamDeepSeek('ds-key-111', req)) { /* drain */ }
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).stream).toBe(true);
  });

  it('throws plain Error when body is null', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const err = await (async () => {
      for await (const _ of streamDeepSeek('ds-key-111', req)) { /* drain */ }
    })().catch(e => e);
    expect(err.message).toBe('DeepSeek stream body is null');
  });
});

describe('callGrok / streamGrok', () => {
  const req: GrokCompletionRequest = { model: 'grok-2-latest', messages: [{ role: 'user', content: 'hi' }] };

  it('calls the x.ai endpoint with bearer auth', async () => {
    const res = await callGrok('grok-key-222', req);
    expect(res.choices[0].message.content).toBe('hello');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.x.ai/v1/chat/completions');
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer grok-key-222',
    });
  });

  it('throws a plain Error on non-ok', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'x' }, 429));
    const err = await callGrok('grok-key-222', req).catch(e => e);
    expect(err.message).toContain('Grok API error 429');
  });

  it('streams deltas', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse(['data: {"choices":[{"delta":{"content":"x"}}]}', 'data: [DONE]']),
    );
    const chunks: string[] = [];
    for await (const c of streamGrok('grok-key-222', req)) chunks.push(c);
    expect(chunks).toEqual(['x']);
  });
});

describe('callVenice / streamVenice', () => {
  const req: VeniceCompletionRequest = { model: 'llama-3.1-70b', messages: [{ role: 'user', content: 'hi' }] };

  it('calls the venice endpoint with bearer auth', async () => {
    const res = await callVenice('venice-key-333', req);
    expect(res.choices[0].message.content).toBe('hello');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.venice.ai/api/v1/chat/completions');
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer venice-key-333',
    });
  });

  it('honors VENICE_BASE_URL env override', async () => {
    process.env.VENICE_BASE_URL = 'https://venice-proxy.example/api/v1';
    await callVenice('venice-key-333', req);
    expect(fetchMock.mock.calls[0][0]).toBe('https://venice-proxy.example/api/v1/chat/completions');
  });

  it('throws ProviderError on non-ok', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'x' }, 401));
    const err = await callVenice('venice-key-333', req).catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(401);
    expect(err.provider).toBe('venice');
  });

  it('streams deltas and throws ProviderError on stream error', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse(['data: {"choices":[{"delta":{"content":"v"}}]}', 'data: [DONE]']),
    );
    const chunks: string[] = [];
    for await (const c of streamVenice('venice-key-333', req)) chunks.push(c);
    expect(chunks).toEqual(['v']);

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'x' }, 500));
    const err = await (async () => {
      for await (const _ of streamVenice('venice-key-333', req)) { /* drain */ }
    })().catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain('Venice stream error 500');
  });
});

describe('callVLLM / streamVLLM', () => {
  const req: VLLMCompletionRequest = { model: 'local-model', messages: [{ role: 'user', content: 'hi' }] };

  it('calls the local endpoint without auth headers', async () => {
    const res = await callVLLM(req);
    expect(res.choices[0].message.content).toBe('hello');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:8000/v1/chat/completions');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('honors VLLM_BASE_URL env override', async () => {
    process.env.VLLM_BASE_URL = 'http://127.0.0.1:9999/v1';
    await callVLLM(req);
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:9999/v1/chat/completions');
  });

  it('throws ProviderError on non-ok', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'x' }, 500));
    const err = await callVLLM(req).catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.provider).toBe('vllm');
  });

  it('streams deltas', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse(['data: {"choices":[{"delta":{"content":"l"}}]}', 'data: [DONE]']),
    );
    const chunks: string[] = [];
    for await (const c of streamVLLM(req)) chunks.push(c);
    expect(chunks).toEqual(['l']);
  });
});

describe('VeniceProvider', () => {
  it('has a fixed name and default model', () => {
    const p = new VeniceProvider('venice-key-333');
    expect(p.name).toBe('venice');
    expect(p.model).toBe('venice-xl');
  });

  it('chat returns content, usage and zero cost', async () => {
    const p = new VeniceProvider('venice-key-333');
    const res = await p.chat([{ role: 'user', content: 'hello' }]);
    expect(res.content).toBe('hello');
    expect(res.usage).toEqual({ promptTokens: 100, completionTokens: 40, totalTokens: 140 });
    expect(res.cost).toBe(0);
    expect(res.model).toBe('some-model');
  });

  it('maps options to snake_case and estimates usage when missing', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'x', object: 'chat.completion', created: 1, model: 'venice-xl',
        choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      }),
    );
    const p = new VeniceProvider('venice-key-333');
    const res = await p.chat([{ role: 'user', content: 'hi' }], { maxTokens: 55, topP: 0.5 });
    expect(res.usage.promptTokens).toBe(8);
    expect(res.usage.completionTokens).toBe(1);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.max_tokens).toBe(55);
    expect(body.top_p).toBe(0.5);
  });

  it('chat throws ProviderError on non-ok', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'x' }, 500));
    const p = new VeniceProvider('venice-key-333');
    const err = await p.chat([{ role: 'user', content: 'hi' }]).catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.provider).toBe('venice');
  });

  it('chatStream yields delta and done chunks with zero cost', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"yo"}}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      ]),
    );
    const p = new VeniceProvider('venice-key-333');
    const chunks = [];
    for await (const c of p.chatStream([{ role: 'user', content: 'hi' }])) chunks.push(c);
    expect(chunks[0]).toEqual({ type: 'delta', content: 'yo' });
    expect(chunks[1]).toMatchObject({ type: 'done', content: 'yo', cost: 0 });
  });

  it('chatStream uses exact usage from a usage chunk', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse(['data: {"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}']),
    );
    const p = new VeniceProvider('venice-key-333');
    const chunks = [];
    for await (const c of p.chatStream([{ role: 'user', content: 'hi' }])) chunks.push(c);
    expect(chunks[0]).toMatchObject({
      type: 'done',
      usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 },
    });
  });

  it('chatStream emits done when the stream ends without markers', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(['data: {"choices":[{"delta":{"content":"z"}}]}']));
    const p = new VeniceProvider('venice-key-333');
    const chunks = [];
    for await (const c of p.chatStream([{ role: 'user', content: 'hi' }])) chunks.push(c);
    expect(chunks[chunks.length - 1]).toMatchObject({ type: 'done', content: 'z' });
  });
});

describe('VLLMProvider', () => {
  it('has a fixed name and default model', () => {
    const p = new VLLMProvider();
    expect(p.name).toBe('vllm');
    expect(p.model).toBe('local-model');
    expect(new VLLMProvider('my-model').model).toBe('my-model');
  });

  it('chat sends no auth header and returns zero cost', async () => {
    const p = new VLLMProvider();
    const res = await p.chat([{ role: 'user', content: 'hello' }]);
    expect(res.content).toBe('hello');
    expect(res.cost).toBe(0);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:8000/v1/chat/completions');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('chat throws ProviderError on non-ok', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'x' }, 503));
    const p = new VLLMProvider();
    const err = await p.chat([{ role: 'user', content: 'hi' }]).catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.provider).toBe('vllm');
    expect(err.status).toBe(503);
  });

  it('chatStream yields deltas and done with zero cost', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"a"}}]}',
        'data: {"choices":[{"delta":{"content":"b"}}]}',
        'data: [DONE]',
      ]),
    );
    const p = new VLLMProvider();
    const chunks = [];
    for await (const c of p.chatStream([{ role: 'user', content: 'hi' }])) chunks.push(c);
    expect(chunks.filter(c => c.type === 'delta').map(c => c.content)).toEqual(['a', 'b']);
    const done = chunks[chunks.length - 1];
    expect(done).toMatchObject({ type: 'done', content: 'ab', cost: 0 });
  });

  it('chatStream uses exact usage from usage chunk', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse(['data: {"usage":{"prompt_tokens":5,"completion_tokens":6,"total_tokens":11}}']),
    );
    const p = new VLLMProvider();
    const chunks = [];
    for await (const c of p.chatStream([{ role: 'user', content: 'hi' }])) chunks.push(c);
    expect(chunks[0]).toMatchObject({
      type: 'done',
      usage: { promptTokens: 5, completionTokens: 6, totalTokens: 11 },
    });
  });

  it('chatStream throws ProviderError when body is null', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const p = new VLLMProvider();
    const err = await (async () => {
      for await (const _ of p.chatStream([{ role: 'user', content: 'hi' }])) { /* drain */ }
    })().catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toBe('vLLM stream body is null');
  });
});
