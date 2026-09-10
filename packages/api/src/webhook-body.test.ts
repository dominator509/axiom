import { describe, expect, it } from 'vitest';
import {
  InvalidContentLengthError,
  RELAY_WEBHOOK_MAX_BODY_BYTES,
  RequestBodyTooLargeError,
  readBoundedBytes,
  readBoundedJson,
  readBoundedText,
} from './webhook-body.js';

describe('bounded webhook bodies', () => {
  it('reads JSON bodies within the limit', async () => {
    await expect(
      readBoundedJson(new Request('https://example.test', { body: '{"ok":true}', method: 'POST' })),
    ).resolves.toEqual({ ok: true });
  });

  it('preserves the exact bytes for callers that hash the body', async () => {
    const bytes = new Uint8Array([0, 1, 2, 255]);
    const request = new Request('https://example.test', {
      method: 'POST',
      body: bytes,
    });
    await expect(readBoundedBytes(request)).resolves.toEqual(bytes);
  });

  it('rejects a declared body larger than the limit before reading it', async () => {
    const request = new Request('https://example.test', {
      method: 'POST',
      headers: { 'content-length': String(RELAY_WEBHOOK_MAX_BODY_BYTES + 1) },
    });
    await expect(readBoundedText(request)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it('rejects a chunked body that crosses the limit', async () => {
    const request = new Request('https://example.test', {
      method: 'POST',
      body: 'x'.repeat(RELAY_WEBHOOK_MAX_BODY_BYTES + 1),
    });
    await expect(readBoundedText(request)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it('rejects malformed content-length metadata', async () => {
    const request = new Request('https://example.test', {
      method: 'POST',
      headers: { 'content-length': 'not-a-number' },
    });
    await expect(readBoundedText(request)).rejects.toBeInstanceOf(InvalidContentLengthError);
  });
});
