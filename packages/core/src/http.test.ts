import { describe, expect, it } from 'vitest';
import {
  AXIOM_JSON_RESPONSE_MAX_BYTES,
  readBoundedResponseBytes,
  readBoundedResponseJson,
} from './http.js';

describe('bounded HTTP response readers', () => {
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
