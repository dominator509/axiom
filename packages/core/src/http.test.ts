import { describe, expect, it, vi } from 'vitest';
import {
  AXIOM_JSON_RESPONSE_MAX_BYTES,
  readBoundedResponseBytes,
  readBoundedResponseJson,
} from './http.js';

describe('bounded HTTP response readers', () => {
  it('bounds a stalled body even when transport cancellation never settles', async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn(() => new Promise<void>(() => undefined));
      const response = new Response(new ReadableStream({ cancel }));
      const outcome = readBoundedResponseJson(response, 25).catch(error => error);
      await vi.advanceTimersByTimeAsync(25);
      expect(await outcome).toMatchObject({ message: 'service JSON response body timed out after 25ms' });
      expect(cancel).toHaveBeenCalledOnce();
      expect(response.body?.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('clears the deadline after a complete body', async () => {
    vi.useFakeTimers();
    try {
      await expect(readBoundedResponseJson(new Response('{"ok":true}'), 25)).resolves.toEqual({ ok: true });
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('parses a normal JSON response', async () => {
    const response = new Response(JSON.stringify({ status: 'ok' }), {
      headers: { 'content-type': 'application/json' },
    });

    await expect(readBoundedResponseJson<{ status: string }>(response)).resolves.toEqual({
      status: 'ok',
    });
  });

  it('rejects an oversized response declared by Content-Length', async () => {
    const response = new Response('{}', {
      headers: { 'content-length': String(AXIOM_JSON_RESPONSE_MAX_BYTES + 1) },
    });

    await expect(readBoundedResponseJson(response)).rejects.toThrow(
      `exceeds the maximum supported size of ${AXIOM_JSON_RESPONSE_MAX_BYTES} bytes`,
    );
  });

  it('cancels a chunked response once it crosses the byte ceiling', async () => {
    let cancelled = false;
    const response = {
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: async () => ({ done: false, value: new Uint8Array([1, 2, 3]) }),
          cancel: async () => {
            cancelled = true;
          },
          releaseLock: () => undefined,
        }),
      },
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response;

    await expect(readBoundedResponseBytes(response, 2, 'test response')).rejects.toThrow(
      'test response exceeds the maximum supported size of 2 bytes',
    );
    expect(cancelled).toBe(true);
  });
});
