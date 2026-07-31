// ─── ContentGenerator — Vitest Suite ───
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ContentGenerator } from './generator.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

const PROMPT = {
  persona: 'energetic coach',
  talkingPoints: ['workout', 'gains'],
  angle: 'fitness motivation',
  emojiStyle: 'moderate' as const,
  cta: 'Follow for more',
};

describe('ContentGenerator.generateBundle', () => {
  it('produces a bundle with one content entry per platform', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ score: 0.01, category: null, explanation: 'ok' })));
    const gen = new ContentGenerator();
    const bundle = await gen.generateBundle('model-1', PROMPT, ['tiktok', 'instagram']);
    expect(bundle.contents).toHaveLength(2);
    expect(bundle.contents.map((c) => c.platform).sort()).toEqual(['instagram', 'tiktok']);
    expect(bundle.contents[0].caption.length).toBeGreaterThan(0);
  });

  it('appends hashtags per platform limits and marks truncation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ score: 0.01, category: null, explanation: 'ok' })));
    const gen = new ContentGenerator();
    // threads max caption is 500 chars — a large talking-point set forces truncation
    const longPrompt = {
      ...PROMPT,
      talkingPoints: Array.from({ length: 25 }, (_, i) => `talking point number ${i} with some extra descriptive detail`),
    };
    const bundle = await gen.generateBundle('model-1', longPrompt, ['threads']);
    const content = bundle.contents[0];
    expect(content.truncated).toBe(true);
    expect(content.caption.length).toBeLessThanOrEqual(500);
  });

  it('builds a token-killer prefix per platform', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ score: 0.01, category: null, explanation: 'ok' })));
    const gen = new ContentGenerator();
    const bundle = await gen.generateBundle('model-1', PROMPT, ['x']);
    expect(bundle.contents[0].tokenKillerPrefix).toContain('[SYSTEM]');
    expect(bundle.contents[0].tokenKillerPrefix).toContain('[PLAYBOOK]');
    expect(bundle.contents[0].tokenKillerPrefix).toContain('[TASK]');
  });

  it('rejects invalid prompt config', async () => {
    const gen = new ContentGenerator();
    await expect(gen.generateBundle('model-1', { emojiStyle: 'loud' } as never, ['x'])).rejects.toThrow();
  });
});
