// ─── VisionEngineClient — Vitest Suite ───
import { describe, it, expect, vi, afterEach } from 'vitest';
import { VisionEngineClient } from './vision.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function rustTosBody(over: Partial<Record<string, unknown>> = {}) {
  return {
    verdict: 'pass',
    nsfw_score: 0.12345,
    reasons: [],
    engine: 'onnx-vit',
    probabilities: [0.05, 0.05, 0.8, 0.05, 0.05],
    labels: ['drawings', 'hentai', 'neutral', 'porn', 'sexy'],
    overridden: false,
    override_source: null,
    ...over,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('VisionEngineClient', () => {
  it('calls the Rust engine with image_path and maps the real response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(rustTosBody())));
    const client = new VisionEngineClient({ baseUrl: 'http://engine.test' });
    const result = await client.callTosClassify('/tmp/img.png');
    expect(result.source).toBe('rust_engine');
    expect(result.score).toBe(0.123); // rounded to 3 decimals
    expect(result.category).toBeNull(); // verdict 'pass' → null
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://engine.test/vision/tos-classify');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body.image_path).toBe('/tmp/img.png');
    expect(body.override).toBeUndefined();
  });

  it('sends the override verdict to the engine', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          rustTosBody({
            verdict: 'block',
            nsfw_score: 1.0,
            overridden: true,
            override_source: 'request',
          }),
        ),
      ),
    );
    const client = new VisionEngineClient({ baseUrl: 'http://engine.test' });
    const result = await client.callTosClassify('/tmp/img.png', { override: 'block' });
    const [, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.override).toBe('block');
    expect(result.category).toBe('block');
    expect(result.overridden).toBe(true);
    expect(result.overrideSource).toBe('request');
  });

  it('falls back to the local heuristic when the engine is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = new VisionEngineClient({
      baseUrl: 'http://engine.test',
      allowLocalFallback: true,
    });
    const result = await client.callTosClassify('aGVsbG8=');
    expect(result.source).toBe('local_fallback');
    expect(typeof result.score).toBe('number');
    expect(result.overridden).toBe(false);
    warn.mockRestore();
  });

  it('nsfw detect flags keyword matches in the heuristic fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = new VisionEngineClient({ allowLocalFallback: true });
    const result = await client.callNsfwDetect('explicit content here');
    expect(result.source).toBe('local_fallback');
    expect(result.score).toBeGreaterThan(0);
  });

  it('fails closed by default when the engine is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const client = new VisionEngineClient();
    await expect(client.callTosClassify('/tmp/img.png')).rejects.toThrow('down');
  });

  it('nsfw detect maps labels above the probability floor to categories', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          nsfw_score: 0.987654,
          confidence: 0.99,
          engine: 'onnx-vit',
          probabilities: [0.001, 0.02, 0.003, 0.9, 0.076],
          labels: ['drawings', 'hentai', 'neutral', 'porn', 'sexy'],
          analysis: {
            dimensions: { width: 640, height: 480 },
            avg_brightness: 50,
            color_variance: 30,
            aspect_ratio: 1.333,
          },
          overridden: false,
          override_source: null,
        }),
      ),
    );
    const client = new VisionEngineClient({ baseUrl: 'http://engine.test' });
    const result = await client.callNsfwDetect('/tmp/img.png');
    expect(result.source).toBe('rust_engine');
    expect(result.score).toBe(0.988);
    expect(result.categories).toEqual(['porn']);
  });

  it('nsfw detect passes the override through', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          nsfw_score: 0.0,
          confidence: 1.0,
          engine: 'override',
          probabilities: [],
          labels: ['drawings', 'hentai', 'neutral', 'porn', 'sexy'],
          analysis: {
            dimensions: { width: 640, height: 480 },
            avg_brightness: 50,
            color_variance: 30,
            aspect_ratio: 1.333,
          },
          overridden: true,
          override_source: 'request',
        }),
      ),
    );
    const client = new VisionEngineClient({ baseUrl: 'http://engine.test' });
    const result = await client.callNsfwDetect('/tmp/img.png', { override: 'pass' });
    const [, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.override).toBe('pass');
    expect(result.overridden).toBe(true);
    expect(result.overrideSource).toBe('request');
    expect(result.categories).toEqual([]);
  });
});
