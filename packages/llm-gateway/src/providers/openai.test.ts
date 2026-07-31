// ─── OpenAIProvider + callOpenAI / streamOpenAI — Vitest Suite ───
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  OpenAIProvider,
  callOpenAI,
  streamOpenAI,
  OPENAI_BASE_URL,
  type OpenAICompletionRequest,
} from './openai.js';
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

const completion = {
  id: 'chatcmpl-9',
  object: 'chat.completion',
  created: 1,
  model: 'gpt-4o',
  choices: [{ index: 0, message: { role: 'assistant', content: 'hi there' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  delete process.env.OPENAI_BASE_URL;
  fetchMock = vi.fn(async () => jsonResponse(completion));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENAI_BASE_URL;
});

describe('ProviderError', () => {
  it('carries name, status, provider and body', () => {
    const err = new ProviderError('boom', 429, 'openai', '{"error":"rate"}');
    expect(err.name).toBe('ProviderError');
    expect(err.status).toBe(429);
    expect(err.provider).toBe('openai');
    expect(err.body).toBe('{"error":"rate"}');
    expect(err.message).toBe('boom');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('callOpenAI', () => {
  const req: OpenAICompletionRequest = {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hi' }],
  };

  it('POSTs to the chat completions endpoint with auth headers', async () => {
    const res = await callOpenAI('sk-test-456', req);
    expect(res).toEqual(completion);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-test-456',
    });
    expect(JSON.parse(init.body as string)).toEqual(req);
  });

  it('honors OPENAI_BASE_URL env override', async () => {
    process.env.OPENAI_BASE_URL = 'https://proxy.example.com/v1';
    await callOpenAI('sk-test-456', req);
    expect(fetchMock.mock.calls[0][0]).toBe('https://proxy.example.com/v1/chat/completions');
  });

  it('throws ProviderError with body on non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad key' }, 401));
    const err = await callOpenAI('bad-key', req).catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(401);
    expect(err.provider).toBe('openai');
    expect(err.body).toBe('{"error":"bad key"}');
    expect(err.message).toContain('OpenAI API error 401');
  });

  it('propagates fetch network failures', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('ECONNREFUSED'));
    await expect(callOpenAI('sk-test-456', req)).rejects.toThrow('ECONNREFUSED');
  });
});

describe('streamOpenAI', () => {
  const req: OpenAICompletionRequest = {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hi' }],
  };

  it('yields content deltas from SSE data lines and stops at [DONE]', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}',
        'data: {"choices":[{"delta":{"content":"lo"}}]}',
        'data: [DONE]',
      ]),
    );
    const chunks: string[] = [];
    for await (const c of streamOpenAI('sk-test-456', req)) chunks.push(c);
    expect(chunks).toEqual(['Hel', 'lo']);
  });

  it('skips malformed JSON lines without failing', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'data: {not json',
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        '',
      ]),
    );
    const chunks: string[] = [];
    for await (const c of streamOpenAI('sk-test-456', req)) chunks.push(c);
    expect(chunks).toEqual(['ok']);
  });

  it('marks the request stream=true in the body', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(['data: [DONE]']));
    for await (const _ of streamOpenAI('sk-test-456', req)) { /* drain */ }
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.stream).toBe(true);
  });

  it('throws ProviderError on non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 500));
    const err = await (async () => {
      for await (const _ of streamOpenAI('sk-test-456', req)) { /* drain */ }
    })().catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(500);
    expect(err.message).toContain('OpenAI stream error 500');
  });

  it('throws ProviderError when the response body is null', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const err = await (async () => {
      for await (const _ of streamOpenAI('sk-test-456', req)) { /* drain */ }
    })().catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toBe('OpenAI stream body is null');
  });

  it('handles deltas split across multiple stream chunks', async () => {
    // Simulate the SSE framing arriving in two separate network reads.
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"con'));
        controller.enqueue(encoder.encode('tent":"split"}}]}'));
        controller.enqueue(encoder.encode('\ndata: [DONE]\n'));
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));
    const chunks: string[] = [];
    for await (const c of streamOpenAI('sk-test-456', req)) chunks.push(c);
    expect(chunks).toEqual(['split']);
  });
});

describe('OpenAIProvider', () => {
  it('has a fixed name and default model', () => {
    const p = new OpenAIProvider('sk-test-456');
    expect(p.name).toBe('openai');
    expect(p.model).toBe('gpt-4o');
    const p2 = new OpenAIProvider('sk-test-456', 'gpt-4o-mini');
    expect(p2.model).toBe('gpt-4o-mini');
  });

  it('chat returns content, usage and computed cost', async () => {
    const p = new OpenAIProvider('sk-test-456');
    const res = await p.chat([{ role: 'user', content: 'hello' }]);
    expect(res.content).toBe('hi there');
    expect(res.model).toBe('gpt-4o');
    expect(res.usage).toEqual({ promptTokens: 1000, completionTokens: 500, totalTokens: 1500 });
    // gpt-4o: (1000*2.5 + 500*10)/1e6
    expect(res.cost).toBeCloseTo(0.0075, 8);
  });

  it('chat maps camelCase options to snake_case request fields', async () => {
    const p = new OpenAIProvider('sk-test-456');
    await p.chat([{ role: 'user', content: 'x' }], {
      temperature: 0.3,
      maxTokens: 64,
      topP: 0.9,
      presencePenalty: 0.5,
      frequencyPenalty: 0.2,
      stop: ['END'],
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({
      model: 'gpt-4o',
      temperature: 0.3,
      max_tokens: 64,
      top_p: 0.9,
      presence_penalty: 0.5,
      frequency_penalty: 0.2,
      stop: ['END'],
    });
  });

  it('estimates usage when the API omits it', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'x',
        object: 'chat.completion',
        created: 1,
        model: 'gpt-4o',
        choices: [{ index: 0, message: { role: 'assistant', content: 'hi there' }, finish_reason: 'stop' }],
      }),
    );
    const p = new OpenAIProvider('sk-test-456');
    const res = await p.chat([{ role: 'user', content: 'hi' }]);
    expect(res.usage.promptTokens).toBe(8); // ceil(30/4)
    expect(res.usage.completionTokens).toBe(2); // ceil(8/4)
    expect(res.usage.totalTokens).toBe(10);
  });

  it('falls back to gpt-4o pricing for unknown models', async () => {
    const p = new OpenAIProvider('sk-test-456', 'mystery-model');
    const res = await p.chat([{ role: 'user', content: 'hello' }]);
    expect(res.cost).toBeCloseTo(0.0075, 8); // same as gpt-4o
  });

  it('uses the model returned by the API when present', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...completion, model: 'gpt-4o-2024-08-06' }));
    const p = new OpenAIProvider('sk-test-456');
    const res = await p.chat([{ role: 'user', content: 'hello' }]);
    expect(res.model).toBe('gpt-4o-2024-08-06');
  });

  it('chat throws ProviderError on non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'over' }, 429));
    const p = new OpenAIProvider('sk-test-456');
    const err = await p.chat([{ role: 'user', content: 'x' }]).catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(429);
    expect(err.provider).toBe('openai');
  });

  it('chat returns empty content for a null message content', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...completion,
        choices: [{ index: 0, message: { role: 'assistant', content: null }, finish_reason: 'stop' }],
      }),
    );
    const p = new OpenAIProvider('sk-test-456');
    const res = await p.chat([{ role: 'user', content: 'x' }]);
    expect(res.content).toBe('');
  });

  it('chatStream yields delta chunks then a done chunk with usage', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}',
        'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}',
      ]),
    );
    const p = new OpenAIProvider('sk-test-456');
    const chunks = [];
    for await (const c of p.chatStream([{ role: 'user', content: 'hi' }])) chunks.push(c);

    expect(chunks[0]).toEqual({ type: 'delta', content: 'Hel' });
    expect(chunks[1]).toEqual({ type: 'delta', content: 'lo' });
    const done = chunks[2];
    expect(done.type).toBe('done');
    expect(done.content).toBe('Hello');
    expect(done.usage).toEqual({
      promptTokens: 8,
      completionTokens: 2,
      totalTokens: 10,
    });
  });

  it('chatStream uses exact usage from a final usage chunk', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"yo"}}]}',
        'data: {"usage":{"prompt_tokens":11,"completion_tokens":22,"total_tokens":33}}',
      ]),
    );
    const p = new OpenAIProvider('sk-test-456');
    const chunks = [];
    for await (const c of p.chatStream([{ role: 'user', content: 'hi' }])) chunks.push(c);
    const done = chunks.find(c => c.type === 'done');
    expect(done).toMatchObject({
      type: 'done',
      content: 'yo',
      usage: { promptTokens: 11, completionTokens: 22, totalTokens: 33 },
    });
    // cost from exact usage: (11*2.5 + 22*10)/1e6
    expect((done as { cost: number }).cost).toBeCloseTo((11 * 2.5 + 22 * 10) / 1e6, 10);
  });

  it('chatStream emits a final done chunk when the stream ends without a stop marker', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(['data: {"choices":[{"delta":{"content":"only"}}]}']));
    const p = new OpenAIProvider('sk-test-456');
    const chunks = [];
    for await (const c of p.chatStream([{ role: 'user', content: 'hi' }])) chunks.push(c);
    expect(chunks[chunks.length - 1]).toMatchObject({ type: 'done', content: 'only' });
  });

  it('chatStream skips malformed JSON lines', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse(['data: garbage', 'data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]']),
    );
    const p = new OpenAIProvider('sk-test-456');
    const chunks = [];
    for await (const c of p.chatStream([{ role: 'user', content: 'hi' }])) chunks.push(c);
    expect(chunks.filter(c => c.type === 'delta').map(c => c.content)).toEqual(['ok']);
  });

  it('chatStream sends stream:true and include_usage in the body', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(['data: [DONE]']));
    const p = new OpenAIProvider('sk-test-456');
    for await (const _ of p.chatStream([{ role: 'user', content: 'hi' }])) { /* drain */ }
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('chatStream throws ProviderError on non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'x' }, 500));
    const p = new OpenAIProvider('sk-test-456');
    const err = await (async () => {
      for await (const _ of p.chatStream([{ role: 'user', content: 'hi' }])) { /* drain */ }
    })().catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
  });

  it('chatStream throws ProviderError when body is null', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const p = new OpenAIProvider('sk-test-456');
    const err = await (async () => {
      for await (const _ of p.chatStream([{ role: 'user', content: 'hi' }])) { /* drain */ }
    })().catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toBe('OpenAI stream body is null');
  });
});

describe('OPENAI_BASE_URL constant', () => {
  it('points at the public OpenAI v1 API', () => {
    expect(OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
  });
});
