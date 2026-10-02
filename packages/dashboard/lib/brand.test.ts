import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BRAND } from '@axiom/core';
import { fetchPublicBrand } from './brand';
afterEach(() => vi.unstubAllGlobals());

describe('server branding request', () => {
  it('uses the API public projection without credentials and without persistent caching', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { name: 'Studio', tagline: 'Hi', secret: 'never' } })));
    vi.stubGlobal('fetch', fetcher);
    expect(await fetchPublicBrand()).toEqual({ name: 'Studio', tagline: 'Hi' });
    expect(fetcher).toHaveBeenCalledWith(expect.stringMatching(/\/api\/v1\/brand$/),
      { cache: 'no-store', signal: expect.any(AbortSignal) });
  });
  it.each([null, {}, { data: [] }, { data: { name: '\n', tagline: 2 } }])('falls back for malformed data %j', async body => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body)));
    expect(await fetchPublicBrand()).toEqual(DEFAULT_BRAND);
  });
  it('falls back on API failure', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 503 }));
    expect(await fetchPublicBrand()).toEqual(DEFAULT_BRAND);
  });
  it('falls back on network failure', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('private diagnostic'); });
    expect(await fetchPublicBrand()).toEqual(DEFAULT_BRAND);
  });
});
