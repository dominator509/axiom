// ─── VisionEngineClient — Vitest Suite ───
import { describe, it, expect, vi, afterEach } from 'vitest';
import { VisionEngineClient } from './vision.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('VisionEngineClient', () => {
  it('calls the Rust engine and marks the source', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ score: 0.12345, category: 'safe', explanation: 'ok' }),
    ));
    const client = new VisionEngineClient({ baseUrl: 'http://engine.test' });
    const result = await client.callTosClassify('aGVsbG8=');
    expect(result.source).toBe('rust_engine');
    expect(result.score).toBe(0.123); // rounded to 3 decimals
    expect(result.category).toBe('safe');
    const [url, init] = (vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit]);
    expect(url).toBe('http://engine.test/vision/tos-classify');
    expect(init.method).toBe('POST');
  });

  it('falls back to the local heuristic when the engine is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = new VisionEngineClient({ baseUrl: 'http://engine.test' });
    const result = await client.callTosClassify('aGVsbG8=');
    expect(result.source).toBe('local_fallback');
    expect(typeof result.score).toBe('number');
    warn.mockRestore();
  });

  it('nsfw detect flags keyword matches in the heuristic fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = new VisionEngineClient();
    const result = await client.callNsfwDetect('explicit content here');
    expect(result.source).toBe('local_fallback');
    expect(result.score).toBeGreaterThan(0);
  });

  it('nsfw detect uses the rust engine when reachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ score: 0.987654, categories: ['nsfw'] }),
    ));
    const client = new VisionEngineClient({ baseUrl: 'http://engine.test' });
    const result = await client.callNsfwDetect('x');
    expect(result.source).toBe('rust_engine');
    expect(result.score).toBe(0.988);
    expect(result.categories).toEqual(['nsfw']);
  });
});
