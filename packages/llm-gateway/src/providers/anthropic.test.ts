// ─── AnthropicProvider + callAnthropic / streamAnthropic — Vitest Suite ───
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AnthropicProvider,
  callAnthropic,
  streamAnthropic,
  ANTHROPIC_BASE_URL,
  type AnthropicMessageRequest,
} from './anthropic.js';
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

const messageResponse = {
  id: 'msg_01',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'Hello from Claude' }],
  model: 'claude-3-5-sonnet-latest',
  stop_reason: 'end_turn',
  usage: { input_tokens: 200, output_tokens: 50 },
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse(messageResponse));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('callAnthropic', () => {
  const req: AnthropicMessageRequest = {
    model: 'claude-3-5-sonnet-latest',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 1000,
  };

  it('POSTs to /v1/messages with anthropic headers', async () => {
    const res = await callAnthropic('ant-key-789', req);
    expect(res).toEqual(messageResponse);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'x-api-key': 'ant-key-789',
      'anthropic-version': '2023-06-01',
    });
    expect(JSON.parse(init.body as string)).toEqual(req);
  });

  it('throws ProviderError with body on non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'bad' } }, 400));
    const err = await callAnthropic('ant-key-789', req).catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(400);
    expect(err.provider).toBe('anthropic');
    expect(err.message).toContain('Anthropic API error 400');
  });

  it('passes an AbortSignal through to fetch', async () => {
    const controller = new AbortController();
    await callAnthropic('ant-key-789', req, controller.signal);
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });
});

describe('streamAnthropic', () => {
  const req: AnthropicMessageRequest = {
    model: 'claude-3-5-sonnet-latest',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 1000,
  };

  it('yields text from content_block_delta events', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'event: content_block_delta',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}',
        'data: [DONE]',
      ]),
    );
    const chunks: string[] = [];
    for await (const c of streamAnthropic('ant-key-789', req)) chunks.push(c);
    expect(chunks).toEqual(['Hel', 'lo']);
  });

  it('skips event: lines and non-data lines', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'event: message_start',
        'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","delta":{"text":"only"}}',
        'data: not json',
      ]),
    );
    const chunks: string[] = [];
    for await (const c of streamAnthropic('ant-key-789', req)) chunks.push(c);
    expect(chunks).toEqual(['only']);
  });

  it('throws ProviderError on non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'x' }, 500));
    const err = await (async () => {
      for await (const _ of streamAnthropic('ant-key-789', req)) { /* drain */ }
    })().catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain('Anthropic stream error 500');
  });

  it('throws ProviderError when body is null', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const err = await (async () => {
      for await (const _ of streamAnthropic('ant-key-789', req)) { /* drain */ }
    })().catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toBe('Anthropic stream body is null');
  });
});

describe('AnthropicProvider', () => {
  it('has a fixed name and default model/api version', () => {
    const p = new AnthropicProvider('ant-key-789');
    expect(p.name).toBe('anthropic');
    expect(p.model).toBe('claude-sonnet-4-5');
  });

  it('chat joins text content blocks and returns usage', async () => {
    const p = new AnthropicProvider('ant-key-789', 'claude-3-5-sonnet-latest');
    const res = await p.chat([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi' },
    ]);
    expect(res.content).toBe('Hello from Claude');
    expect(res.usage).toEqual({ promptTokens: 200, completionTokens: 50, totalTokens: 250 });
    // claude-3-5-sonnet-latest: (200*3.0 + 50*15.0)/1e6
    expect(res.cost).toBeCloseTo((200 * 3 + 50 * 15) / 1e6, 10);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.system).toBe('be terse');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.max_tokens).toBe(4096);
  });

  it('concatenates multiple system messages with newlines', async () => {
    const p = new AnthropicProvider('ant-key-789');
    await p.chat([
      { role: 'system', content: 'part-one' },
      { role: 'system', content: 'part-two' },
      { role: 'user', content: 'hi' },
    ]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.system).toBe('part-one\npart-two');
  });

  it('inserts a user message when only system messages are given', async () => {
    const p = new AnthropicProvider('ant-key-789');
    await p.chat([{ role: 'system', content: 'only system' }]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello.' }]);
    expect(body.system).toBe('only system');
  });

  it('maps options to anthropic body fields', async () => {
    const p = new AnthropicProvider('ant-key-789');
    await p.chat([{ role: 'user', content: 'hi' }], {
      temperature: 0.4,
      topP: 0.8,
      maxTokens: 777,
      stop: ['END'],
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.temperature).toBe(0.4);
    expect(body.top_p).toBe(0.8);
    expect(body.max_tokens).toBe(777);
    expect(body.stop_sequences).toEqual(['END']);
  });

  it('estimates usage and uses fallback pricing for unknown models', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'msg_02',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
        model: 'some-model',
        stop_reason: null,
      }),
    );
    const p = new AnthropicProvider('ant-key-789', 'unknown-model');
    const res = await p.chat([{ role: 'user', content: 'hi' }]);
    expect(res.usage.promptTokens).toBe(8); // ceil(30/4)
    expect(res.usage.completionTokens).toBe(1); // ceil(2/4)
    expect(res.cost).toBeCloseTo((8 * 3 + 1 * 15) / 1e6, 10);
  });

  it('filters non-text content blocks', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...messageResponse,
        content: [
          { type: 'text', text: 'A' },
          { type: 'tool_use', id: 't1', name: 'x', input: {} },
          { type: 'text', text: 'B' },
        ],
      }),
    );
    const p = new AnthropicProvider('ant-key-789');
    const res = await p.chat([{ role: 'user', content: 'hi' }]);
    expect(res.content).toBe('AB');
  });

  it('chat throws ProviderError on non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'x' }, 401));
    const p = new AnthropicProvider('ant-key-789');
    const err = await p.chat([{ role: 'user', content: 'hi' }]).catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(401);
    expect(err.provider).toBe('anthropic');
  });

  it('chatStream yields deltas and a done chunk on message_stop', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'event: message_start',
        'data: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":0}}}',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi "}}',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"there"}}',
        'event: message_stop',
        'data: {"type":"message_stop"}',
      ]),
    );
    const p = new AnthropicProvider('ant-key-789');
    const chunks = [];
    for await (const c of p.chatStream([{ role: 'user', content: 'hi' }])) chunks.push(c);

    expect(chunks.filter(c => c.type === 'delta').map(c => c.content)).toEqual(['Hi ', 'there']);
    const done = chunks[chunks.length - 1];
    expect(done).toMatchObject({ type: 'done', content: 'Hi there' });
    // input tokens came from message_start usage (12), not the estimate
    expect((done as { usage: { promptTokens: number } }).usage.promptTokens).toBe(12);
  });

  it('chatStream handles content_block_start deltas', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'event: content_block_start',
        'data: {"type":"content_block_start","content_block":{"type":"text","text":"Lead"}}',
        'event: message_delta',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
      ]),
    );
    const p = new AnthropicProvider('ant-key-789');
    const chunks = [];
    for await (const c of p.chatStream([{ role: 'user', content: 'hi' }])) chunks.push(c);
    expect(chunks[0]).toEqual({ type: 'delta', content: 'Lead' });
    expect(chunks[1]).toMatchObject({ type: 'done', content: 'Lead' });
  });

  it('chatStream emits a final done chunk when the stream ends without stop events', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse(['event: content_block_delta', 'data: {"type":"content_block_delta","delta":{"text":"z"}}']),
    );
    const p = new AnthropicProvider('ant-key-789');
    const chunks = [];
    for await (const c of p.chatStream([{ role: 'user', content: 'hi' }])) chunks.push(c);
    expect(chunks[chunks.length - 1]).toMatchObject({ type: 'done', content: 'z' });
  });

  it('chatStream throws ProviderError on non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'x' }, 500));
    const p = new AnthropicProvider('ant-key-789');
    const err = await (async () => {
      for await (const _ of p.chatStream([{ role: 'user', content: 'hi' }])) { /* drain */ }
    })().catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
  });
});

describe('ANTHROPIC_BASE_URL constant', () => {
  it('points at the public Anthropic v1 API', () => {
    expect(ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com/v1');
  });
});
