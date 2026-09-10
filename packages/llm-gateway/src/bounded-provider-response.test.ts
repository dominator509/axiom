import { describe, expect, it } from 'vitest';
import {
  LLM_PROVIDER_JSON_MAX_BYTES,
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
});
