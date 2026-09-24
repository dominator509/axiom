// ─── ToSEngine — Vitest Suite ───
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ToSEngine,
  DEFAULT_PLATFORM_THRESHOLDS,
  PLATFORM_RULES,
  evaluateTextToS,
} from './tos-engine.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.unstubAllGlobals());

/** Stub the vision engine fetch so classifyImage is deterministic. */
function stubVision(
  score: number,
  category: string | null = null,
  extra: Record<string, unknown> = {},
) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      jsonResponse({
        verdict: category ?? 'pass',
        nsfw_score: score,
        reasons: category ? [`engine: ${category}`] : [],
        engine: 'onnx-vit',
        probabilities: [0, 0, 0, score, 0],
        labels: ['drawings', 'hentai', 'neutral', 'porn', 'sexy'],
        overridden: false,
        override_source: null,
        ...extra,
      }),
    ),
  );
}

describe('configuration surface', () => {
  it('defines a threshold for every supported platform', () => {
    for (const platform of Object.keys(PLATFORM_RULES)) {
      expect(
        typeof DEFAULT_PLATFORM_THRESHOLDS[platform as keyof typeof DEFAULT_PLATFORM_THRESHOLDS],
      ).toBe('number');
    }
  });

  it('merges custom thresholds over defaults', () => {
    const engine = new ToSEngine({ tiktok: 90 });
    expect(engine.getPlatformThreshold('tiktok')).toBe(90);
    expect(engine.getPlatformThreshold('instagram')).toBe(70);
    // Unknown platforms fall back to a safe default
    expect(engine.getPlatformThreshold('telegram')).toBe(70);
  });
});

describe('classifyImage', () => {
  it('converts the engine score to a 0-100 integer', async () => {
    stubVision(0.4321, 'review');
    const engine = new ToSEngine();
    const result = await engine.classifyImage('/tmp/img.png');
    expect(result.score).toBe(43);
    expect(result.category).toBe('review');
    expect(result.explanation).toContain('engine');
  });

  it('forwards an override to the engine', async () => {
    stubVision(1.0, 'block', { overridden: true, override_source: 'request' });
    const engine = new ToSEngine();
    const result = await engine.classifyImage('/tmp/img.png', { override: 'block' });
    const [, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.override).toBe('block');
    expect(result.category).toBe('block');
  });
});

describe('evaluate', () => {
  it('carries only an un-overridden Rust visual receipt as optional evidence', async () => {
    const fetcher = vi.fn().mockImplementation(async (input: string) => {
      if (input.endsWith('/vision/nsfw-detect')) {
        return jsonResponse({
          nsfw_score: 0.12, confidence: 0.93, engine: 'onnx-vit',
          probabilities: [0, 0, 0, 0.12, 0], labels: ['drawings', 'hentai', 'neutral', 'porn', 'sexy'],
          analysis: {
            dimensions: { width: 864, height: 1152 }, avg_brightness: 120,
            color_variance: 22, aspect_ratio: 0.75,
          }, overridden: false, override_source: null,
        });
      }
      return jsonResponse({
        verdict: 'pass', nsfw_score: 0.12, reasons: [], engine: 'onnx-vit',
        probabilities: [0, 0, 0, 0.12, 0], labels: ['drawings', 'hentai', 'neutral', 'porn', 'sexy'],
        overridden: false, override_source: null,
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const result = await new ToSEngine().evaluate({ imageData: '/tmp/img.png' }, ['instagram']);
    expect(result.visualAnalysis).toEqual({
      version: 'vision-analysis-v1', source: 'rust_engine', confidence: 0.93,
      dimensions: { width: 864, height: 1152 }, avgBrightness: 120,
      colorVariance: 22, aspectRatio: 0.75,
    });
  });

  it('never creates trusted visual evidence for an overridden evaluation', async () => {
    stubVision(0, 'pass', {
      overridden: true, override_source: 'request',
      analysis: {
        dimensions: { width: 864, height: 1152 }, avg_brightness: 120,
        color_variance: 22, aspect_ratio: 0.75,
      }, confidence: 1,
    });
    const result = await new ToSEngine().evaluate({ imageData: '/tmp/img.png' }, ['instagram'], { override: 'pass' });
    expect(result.visualAnalysis).toBeUndefined();
  });

  it.each([null, undefined])('does not produce a passing report from missing score case %#', async (score) => {
    stubVision(0, null, { nsfw_score: score });
    await expect(new ToSEngine().evaluate({ imageData: 'image.png' }, ['tiktok']))
      .rejects.toThrow('invalid nsfw_score');
  });

  it('passes clean content under the threshold', async () => {
    stubVision(0.01, null);
    const engine = new ToSEngine();
    const result = await engine.evaluate({ imageData: '/tmp/img.png' }, ['tiktok']);
    expect(result.verdict).toBe('pass');
    expect(result.scores[0].verdict).toBe('pass');
  });

  it('flags review when the score crosses the threshold', async () => {
    stubVision(0.7, 'review');
    const engine = new ToSEngine({ tiktok: 65 });
    const result = await engine.evaluate({ imageData: '/tmp/img.png' }, ['tiktok']);
    // score 70 >= threshold 65 but < 80 → review
    expect(result.verdict).toBe('review');
  });

  it('blocks when the score exceeds threshold + 15', async () => {
    stubVision(0.9, 'block');
    const engine = new ToSEngine({ tiktok: 65 });
    const result = await engine.evaluate({ imageData: '/tmp/img.png' }, ['tiktok']);
    expect(result.verdict).toBe('block');
  });

  it('adds blocked-keyword reasons and boosts the score', async () => {
    stubVision(0.01, null);
    const engine = new ToSEngine({ tiktok: 65 });
    const result = await engine.evaluate(
      { imageData: '/tmp/img.png', caption: 'check my onlyfans for more' },
      ['tiktok'],
    );
    expect(result.reasons.some((r) => r.includes('blocked keywords'))).toBe(true);
    expect(result.scores[0].score).toBeGreaterThan(1);
    expect(result.verdict).toBe('block');
  });

  it('aggregates: block wins over review wins over pass', async () => {
    stubVision(0.9, 'block');
    const engine = new ToSEngine();
    const result = await engine.evaluate({ imageData: '/tmp/img.png' }, ['instagram', 'tiktok']);
    expect(result.verdict).toBe('block');
  });

  it('reports caption length and hashtag limit violations', async () => {
    stubVision(0.01, null);
    const engine = new ToSEngine();
    const result = await engine.evaluate(
      { imageData: '/tmp/img.png', caption: 'a'.repeat(9999), hashtags: Array(100).fill('h') },
      ['threads'], // threads limit is 500 chars / 10 hashtags
    );
    expect(result.reasons.some((r) => r.includes('character limit'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('Hashtag count'))).toBe(true);
    expect(result.verdict).toBe('review');
  });

  it('treats text-only hard keywords as blocks and provider limits as review', () => {
    expect(evaluateTextToS('check my onlyfans', [], ['tiktok']).verdict).toBe('block');
    expect(evaluateTextToS('a'.repeat(501), [], ['threads']).verdict).toBe('review');
    expect(evaluateTextToS('safe caption', Array(11).fill('tag'), ['threads']).verdict).toBe(
      'review',
    );
    expect(evaluateTextToS('visit https://example.test', [], ['threads']).verdict).toBe('review');
    expect(evaluateTextToS('safe caption', [], ['threads']).verdict).toBe('pass');
  });

  it('enforces the product SFW boundary for public Instagram, X and Reddit captions', () => {
    for (const platform of ['instagram', 'x', 'reddit'] as const) {
      expect(evaluateTextToS('A safe public caption about adult content', [], [platform]).verdict).toBe('block');
      expect(evaluateTextToS('A public caption about sex education', [], [platform]).verdict).toBe('block');
      expect(evaluateTextToS('The Essex coast is beautiful', [], [platform]).verdict).toBe('pass');
      expect(PLATFORM_RULES[platform].reviewCategories).toContain('suggestive');
    }
  });

  it('forwards an override through evaluate', async () => {
    stubVision(0.0, 'pass', { overridden: true, override_source: 'request' });
    const engine = new ToSEngine();
    const result = await engine.evaluate({ imageData: '/tmp/img.png' }, ['tiktok'], {
      override: 'pass',
    });
    const [, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.override).toBe('pass');
    expect(result.verdict).toBe('pass');
  });
});
