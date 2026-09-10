import { describe, expect, it } from 'vitest';
import {
  LLM_PROVIDER_SSE_LINE_MAX_BYTES,
  LLM_PROVIDER_STREAM_MAX_BYTES,
  LLM_PROVIDER_JSON_MAX_BYTES,
  readBoundedProviderSseLines,
  readBoundedProviderText,
  readProviderErrorText,
  readProviderJson,
} from './bounded-provider-response.js';

describe('bounded provider responses', () => {
  it('parses a normal JSON response', async () => {
    await expect(readProviderJson<{ ok: boolean }>(new Response('{"ok":true}'))).resolves.toEqual({
      ok: true,
    });
  });

  it('rejects a streamed response over the JSON ceiling', async () => {
    await expect(
      readProviderJson(new Response('x'.repeat(LLM_PROVIDER_JSON_MAX_BYTES + 1))),
    ).rejects.toThrow('provider JSON response exceeds the maximum supported size of 1048576 bytes');
  });

  it('returns an empty error body when the provider error is oversized', async () => {
    await expect(readProviderErrorText(new Response('x'.repeat(64 * 1024 + 1)))).resolves.toBe('');
  });

  it('preserves UTF-8 text while enforcing byte limits', async () => {
    await expect(readBoundedProviderText(new Response('héllo'), 6, 'text')).resolves.toBe('héllo');
    await expect(readBoundedProviderText(new Response('héllo'), 5, 'text')).rejects.toThrow(
      'text exceeds the maximum supported size of 5 bytes',
    );
  });

  it('splits SSE lines across reads and flushes a final unterminated line', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: first\ndata: sec'));
        controller.enqueue(encoder.encode('ond'));
        controller.close();
      },
    });

    const lines: string[] = [];
    for await (const line of readBoundedProviderSseLines(body)) lines.push(line);
    expect(lines).toEqual(['data: first', 'data: second']);
  });

  it('rejects an oversized SSE line before JSON parsing', async () => {
    const body = new Response(`data: ${'x'.repeat(LLM_PROVIDER_SSE_LINE_MAX_BYTES)}`).body;
    await expect(readAllSseLines(body!)).rejects.toThrow(
      `provider SSE stream line exceeds the maximum supported size of ${LLM_PROVIDER_SSE_LINE_MAX_BYTES} bytes`,
    );
  });

  it('rejects an oversized total SSE stream', async () => {
    const line = `data: ${'x'.repeat(900 * 1024)}`;
    const body = new Response(`${line}\n${line}\n${line}\n${line}\n${line}`).body;
    await expect(readAllSseLines(body!)).rejects.toThrow(
      `provider SSE stream exceeds the maximum supported size of ${LLM_PROVIDER_STREAM_MAX_BYTES} bytes`,
    );
  });
});

async function readAllSseLines(body: ReadableStream<Uint8Array>): Promise<string[]> {
  const lines: string[] = [];
  for await (const line of readBoundedProviderSseLines(body)) lines.push(line);
  return lines;
}
