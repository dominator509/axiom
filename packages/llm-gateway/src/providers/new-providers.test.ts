// ─── Mistral / Lightning / Google provider tests — Vitest Suite ───
import { describe, it, expect, vi, afterEach } from 'vitest';
import { callMistral, streamMistral, MISTRAL_BASE_URL } from './mistral.js';
import { callLightning, streamLightning, LIGHTNING_BASE_URL } from './lightning.js';
import { callGoogle, streamGoogle, GOOGLE_BASE_URL } from './google.js';

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
  model: 'test-model',
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('callMistral', () => {
  it('posts to the Mistral chat completions endpoint with bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(openaiStyleCompletion('bonjour')));
    vi.stubGlobal('fetch', fetchMock);

    const res = await callMistral('sk-test', {
      model: 'mistral-small-latest',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(res.choices[0].message.content).toBe('bonjour');
    expect(res.usage.total_tokens).toBe(140);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${MISTRAL_BASE_URL}/chat/completions`);
    expect(init!.headers.Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init!.body as string).stream).toBeUndefined();
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, 401)));
    await expect(callMistral('sk-test', { model: 'm', messages: [] })).rejects.toThrow('Mistral API error 401');
  });
});

describe('streamMistral', () => {
  it('yields delta content chunks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"hel"}}]}',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      'data: [DONE]',
    ])));

    const chunks: string[] = [];
    for await (const c of streamMistral('sk-test', { model: 'm', messages: [] })) chunks.push(c);
    expect(chunks).toEqual(['hel', 'lo']);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(init!.body as string).stream).toBe(true);
  });
});

describe('callLightning', () => {
  it('posts to the Lightning chat completions endpoint with bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(openaiStyleCompletion('hi there')));
    vi.stubGlobal('fetch', fetchMock);

    const res = await callLightning('lt-test', {
      model: 'lightning-v2',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(res.choices[0].message.content).toBe('hi there');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${LIGHTNING_BASE_URL}/chat/completions`);
    expect(init!.headers.Authorization).toBe('Bearer lt-test');
  });
});

describe('streamLightning', () => {
  it('yields delta content chunks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"a"}}]}',
      'data: {"choices":[{"delta":{"content":"b"}}]}',
      'data: [DONE]',
    ])));

    const chunks: string[] = [];
    for await (const c of streamLightning('lt-test', { model: 'm', messages: [] })) chunks.push(c);
    expect(chunks).toEqual(['a', 'b']);
  });
});

describe('callGoogle', () => {
  it('translates Gemini generateContent responses to the shared OpenAI-compatible shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      candidates: [{ content: { parts: [{ text: 'from gemini' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20, totalTokenCount: 70 },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await callGoogle('AIza-test', {
      model: 'gemini-2.0-flash',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hello' },
      ],
    });

    expect(res.choices[0].message.content).toBe('from gemini');
    expect(res.usage.prompt_tokens).toBe(50);
    expect(res.usage.completion_tokens).toBe(20);
    expect(res.usage.total_tokens).toBe(70);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(`${GOOGLE_BASE_URL}/models/gemini-2.0-flash:generateContent`);
    expect(url).toContain('key=AIza-test');
    const sent = JSON.parse(init!.body as string);
    expect(sent.systemInstruction.parts[0].text).toBe('be brief');
    expect(sent.contents[0].role).toBe('user');
    // No bearer header for Gemini — key travels in query string
    expect(init!.headers.Authorization).toBeUndefined();
  });

  it('maps assistant role to model role for Gemini contents', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    })));

    await callGoogle('AIza-test', {
      model: 'gemini-2.0-flash',
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ],
    });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const sent = JSON.parse(init!.body as string);
    expect(sent.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model']);
  });

  it('surfaces Gemini error objects as errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      error: { code: 400, message: 'invalid arg', status: 'INVALID_ARGUMENT' },
    })));
    await expect(
      callGoogle('AIza-test', { model: 'gemini-2.0-flash', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow('Gemini API error 400: invalid arg');
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'nope' }, 429)));
    await expect(
      callGoogle('AIza-test', { model: 'gemini-2.0-flash', messages: [] }),
    ).rejects.toThrow('Gemini API error 429');
  });
});

describe('streamGoogle', () => {
  it('yields text parts from SSE streamGenerateContent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      'data: {"candidates":[{"content":{"parts":[{"text":"one "}]}}]}',
      'data: {"candidates":[{"content":{"parts":[{"text":"two"}]}}]}',
    ])));

    const chunks: string[] = [];
    for await (const c of streamGoogle('AIza-test', { model: 'gemini-2.0-flash', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(c);
    }
    expect(chunks).toEqual(['one ', 'two']);
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain(':streamGenerateContent?alt=sse');
  });
});
