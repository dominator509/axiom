// ─── CardRenderer — Vitest Suite ───
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CardRenderer, type BundleContent, type RelayCard } from './card.js';

const renderer = new CardRenderer();

function makeBundle(overrides: Partial<BundleContent> = {}): BundleContent {
  return {
    id: 'bundle-123',
    mediaUrls: ['https://cdn.example/1.jpg', 'https://cdn.example/2.jpg'],
    caption: 'Summer drop is here 🔥',
    captionVariants: { catchy: 'You need this now' },
    hashtagSets: { tiktok: ['#summer', '#drop', '#fyp', '#viral', '#hot', '#extra'] },
    tosScores: { tiktok: 0.9, instagram: 0.4 },
    targetPlatforms: ['tiktok', 'instagram'],
    ...overrides,
  };
}

function makeCard(overrides: Partial<RelayCard> = {}): RelayCard {
  return {
    bundleId: 'bundle-123',
    mediaPreview: 'https://cdn.example/1.jpg',
    caption: 'Summer drop is here 🔥',
    captionVariants: {},
    hashtagSets: { tiktok: ['#summer', '#fyp'] },
    verdicts: [
      { platform: 'tiktok', passed: true, score: 0.9, reason: 'ToS check passed' },
      {
        platform: 'instagram',
        passed: false,
        score: 0.4,
        reason: 'ToS check failed — score below threshold',
      },
    ],
    targetPlatforms: ['tiktok', 'instagram'],
    actions: ['regenerate', 'revise', 'reject', 'hold'],
    timestamp: 1_700_000_000_000,
    format: 'html',
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('renderBundleCard', () => {
  it('produces a RelayCard with verdicts for every target platform', () => {
    const card = renderer.renderBundleCard(makeBundle());
    expect(card.bundleId).toBe('bundle-123');
    expect(card.mediaPreview).toBe('https://cdn.example/1.jpg');
    expect(card.caption).toBe('Summer drop is here 🔥');
    expect(card.format).toBe('html');
    expect(card.timestamp).toBeGreaterThan(0);
    expect(card.verdicts).toHaveLength(2);
    expect(card.verdicts[0]).toMatchObject({ platform: 'tiktok', passed: true, score: 0.9 });
    expect(card.verdicts[1]).toMatchObject({
      platform: 'instagram',
      passed: false,
      score: 0.4,
      reason: 'ToS check failed — score below threshold',
    });
  });

  it('preserves the persistent card id for dispatch callbacks', () => {
    const card = renderer.renderBundleCard(makeBundle({ cardId: 'card-456' }));
    expect(card.cardId).toBe('card-456');
  });

  it('passes verdict when platform has no ToS score (defaults to 1)', () => {
    const card = renderer.renderBundleCard(
      makeBundle({ tosScores: {}, targetPlatforms: ['tiktok'] }),
    );
    expect(card.verdicts[0]).toMatchObject({ passed: true, score: 1, reason: 'ToS check passed' });
  });

  it('all-passed bundles get the full approve action set', () => {
    const card = renderer.renderBundleCard(
      makeBundle({ tosScores: { tiktok: 0.95, instagram: 0.8 } }),
    );
    expect(card.actions).toEqual([
      'approve',
      'approve_all',
      'edit_caption',
      'change_price',
      'reschedule',
      'reject',
      'hold',
    ]);
  });

  it('bundles with any failing verdict get regenerate/revise action set', () => {
    const card = renderer.renderBundleCard(makeBundle());
    expect(card.actions).toEqual(['regenerate', 'revise', 'reject', 'hold']);
  });

  it('handles an empty mediaUrls array and missing optional fields', () => {
    const card = renderer.renderBundleCard(makeBundle({ mediaUrls: [], targetPlatforms: [] }));
    expect(card.mediaPreview).toBe('');
    expect(card.verdicts).toEqual([]);
    expect(card.actions).toEqual([
      'approve',
      'approve_all',
      'edit_caption',
      'change_price',
      'reschedule',
      'reject',
      'hold',
    ]);
    expect(card.price).toBeUndefined();
    expect(card.scheduleAt).toBeUndefined();
  });

  it('preserves price and scheduleAt when provided', () => {
    const card = renderer.renderBundleCard(
      makeBundle({ price: 29.99, scheduleAt: '2026-08-01T12:00:00Z' }),
    );
    expect(card.price).toBe(29.99);
    expect(card.scheduleAt).toBe('2026-08-01T12:00:00Z');
  });
});

describe('toHtml', () => {
  it('renders bundle id, caption, verdicts and hashtags', () => {
    const html = renderer.toHtml(makeCard());
    expect(html).toContain('📦 Bundle: bundle-123');
    expect(html).toContain('<b>Caption:</b> Summer drop is here 🔥');
    expect(html).toContain('tiktok:</b> ✅ PASS (90%)');
    expect(html).toContain('instagram:</b> ❌ FAIL (40%)');
    expect(html).toContain('#summer #fyp');
  });

  it('truncates caption to 200 chars', () => {
    const longCaption = 'x'.repeat(500);
    const html = renderer.toHtml(makeCard({ caption: longCaption }));
    expect(html).toContain('x'.repeat(200));
    expect(html).not.toContain('x'.repeat(201));
  });

  it('limits hashtags to 5 per platform', () => {
    const html = renderer.toHtml(
      makeCard({
        hashtagSets: { tiktok: ['#1', '#2', '#3', '#4', '#5', '#6', '#7'] },
      }),
    );
    expect(html).toContain('#1 #2 #3 #4 #5');
    expect(html).not.toContain('#6');
  });

  it('includes price and schedule lines only when present', () => {
    const withOpts = renderer.toHtml(
      makeCard({ price: 19.99, scheduleAt: '2026-09-01T00:00:00Z' }),
    );
    expect(withOpts).toContain('Price:</b> $19.99');
    expect(withOpts).toContain('Scheduled:</b> 2026-09-01T00:00:00Z');

    const withoutOpts = renderer.toHtml(makeCard({ price: undefined, scheduleAt: undefined }));
    expect(withoutOpts).not.toContain('Price:');
    expect(withoutOpts).not.toContain('Scheduled:');
  });

  it('renders an empty verdict block when there are no verdicts', () => {
    const html = renderer.toHtml(makeCard({ verdicts: [] }));
    expect(html).toContain('ToS Verdicts:');
  });
});

describe('toEmbed', () => {
  it('builds a discord-style embed payload', () => {
    const embed = renderer.toEmbed(makeCard());
    expect(embed.title).toBe('📦 Bundle: bundle-1');
    expect(embed.description).toBe('Summer drop is here 🔥');
    expect(embed.color).toBe(0xff0000); // red — some verdict failed
    expect(embed.fields).toHaveLength(2);
    expect(embed.timestamp).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('is green when every verdict passes', () => {
    const embed = renderer.toEmbed(
      makeCard({
        verdicts: [{ platform: 'tiktok', passed: true, score: 0.9, reason: 'ok' }],
      }),
    );
    expect(embed.color).toBe(0x00ff00);
  });

  it('adds price and scheduled fields only when present', () => {
    const withOpts = renderer.toEmbed(makeCard({ price: 9.5, scheduleAt: '2026-08-02T00:00:00Z' }));
    const fieldNames = (withOpts.fields as Array<{ name: string }>).map((f) => f.name);
    expect(fieldNames).toContain('Price');
    expect(fieldNames).toContain('Scheduled');

    const withoutOpts = renderer.toEmbed(makeCard({ price: undefined, scheduleAt: undefined }));
    const names = (withoutOpts.fields as Array<{ name: string }>).map((f) => f.name);
    expect(names).not.toContain('Price');
    expect(names).not.toContain('Scheduled');
  });

  it('truncates description to 400 chars and title to 8 bundle chars', () => {
    const embed = renderer.toEmbed(
      makeCard({ caption: 'y'.repeat(600), bundleId: 'super-long-bundle-id' }),
    );
    expect(embed.title).toBe('📦 Bundle: super-lo');
    expect((embed.description as string).length).toBe(400);
  });
});

describe('toText', () => {
  it('renders numbered actions and verdict lines', () => {
    const text = renderer.toText(makeCard());
    expect(text).toContain('📦 Bundle: bundle-123');
    expect(text).toContain('tiktok: PASS (90%)');
    expect(text).toContain('instagram: FAIL (40%)');
    expect(text).toContain('1. regenerate');
    expect(text).toContain('2. revise');
    expect(text).toContain('4. hold');
  });

  it('truncates caption to 200 chars', () => {
    const text = renderer.toText(makeCard({ caption: 'z'.repeat(300) }));
    expect(text).toContain('z'.repeat(200));
    expect(text).not.toContain('z'.repeat(201));
  });
});
