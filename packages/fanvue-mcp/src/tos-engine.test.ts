// ─── ToSEngine — Vitest Suite ───
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ToSEngine, DEFAULT_PLATFORM_THRESHOLDS, PLATFORM_RULES } from './tos-engine.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

/** Stub the vision engine fetch so classifyImage is deterministic. */
function stubVision(score: number, category: string | null = null) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    jsonResponse({ score, category, explanation: 'engine' }),
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
    stubVision(0.4321, 'safe');
    const engine = new ToSEngine();
    const result = await engine.classifyImage('aGVsbG8=');
    expect(result.score).toBe(43);
    expect(result.category).toBe('safe');
    expect(result.explanation).toBe('engine');
  });
});

describe('evaluate', () => {
  it('passes clean content under the threshold', async () => {
    stubVision(0.01, null);
    const engine = new ToSEngine();
    const result = await engine.evaluate({ imageData: 'x' }, ['tiktok']);
    expect(result.verdict).toBe('pass');
    expect(result.scores[0].verdict).toBe('pass');
  });

  it('flags review when the score crosses the threshold', async () => {
    stubVision(0.7, 'risky');
    const engine = new ToSEngine({ tiktok: 65 });
    const result = await engine.evaluate({ imageData: 'x' }, ['tiktok']);
    // score 70 >= threshold 65 but < 80 → review
    expect(result.verdict).toBe('review');
  });

  it('blocks when the score exceeds threshold + 15', async () => {
    stubVision(0.9, 'explicit');
    const engine = new ToSEngine({ tiktok: 65 });
    const result = await engine.evaluate({ imageData: 'x' }, ['tiktok']);
    expect(result.verdict).toBe('block');
  });

  it('adds blocked-keyword reasons and boosts the score', async () => {
    stubVision(0.01, null);
    const engine = new ToSEngine({ tiktok: 65 });
    const result = await engine.evaluate({ imageData: 'x', caption: 'check my onlyfans for more' }, ['tiktok']);
    expect(result.reasons.some((r) => r.includes('blocked keywords'))).toBe(true);
    expect(result.scores[0].score).toBeGreaterThan(1);
  });

  it('aggregates: block wins over review wins over pass', async () => {
    stubVision(0.9, 'explicit');
    const engine = new ToSEngine();
    const result = await engine.evaluate({ imageData: 'x' }, ['instagram', 'tiktok']);
    expect(result.verdict).toBe('block');
  });

  it('reports caption length and hashtag limit violations', async () => {
    stubVision(0.01, null);
    const engine = new ToSEngine();
    const result = await engine.evaluate(
      { imageData: 'x', caption: 'a'.repeat(9999), hashtags: Array(100).fill('h') },
      ['threads'], // threads limit is 500 chars / 10 hashtags
    );
    expect(result.reasons.some((r) => r.includes('character limit'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('Hashtag count'))).toBe(true);
  });
});
