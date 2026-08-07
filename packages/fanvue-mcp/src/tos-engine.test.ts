// ─── ToSEngine — Vitest Suite ───
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ToSEngine, DEFAULT_PLATFORM_THRESHOLDS, PLATFORM_RULES } from './tos-engine.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

/** Stub the vision engine fetch so classifyImage is deterministic. */
function stubVision(score: number, category: string | null = null, extra: Record<string, unknown> = {}) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
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
  ));
}

describe('configuration surface', () => {
  it('defines a threshold for every supported platform', () => {
    for (const platform of Object.keys(PLATFORM_RULES)) {
      expect(typeof DEFAULT_PLATFORM_THRESHOLDS[platform as keyof typeof DEFAULT_PLATFORM_THRESHOLDS]).toBe('number');
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
    const [, init] = (vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit]);
    const body = JSON.parse(String(init.body));
    expect(body.override).toBe('block');
    expect(result.category).toBe('block');
  });
});

describe('evaluate', () => {
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
    const result = await engine.evaluate({ imageData: '/tmp/img.png', caption: 'check my onlyfans for more' }, ['tiktok']);
    expect(result.reasons.some((r) => r.includes('blocked keywords'))).toBe(true);
    expect(result.scores[0].score).toBeGreaterThan(1);
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
  });

  it('forwards an override through evaluate', async () => {
    stubVision(0.0, 'pass', { overridden: true, override_source: 'request' });
    const engine = new ToSEngine();
    const result = await engine.evaluate({ imageData: '/tmp/img.png' }, ['tiktok'], { override: 'pass' });
    const [, init] = (vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit]);
    const body = JSON.parse(String(init.body));
    expect(body.override).toBe('pass');
    expect(result.verdict).toBe('pass');
  });
});
