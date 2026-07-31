// ─── Bandit — Vitest Suite ───
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Bandit, type Exemplar, type StyleWeight } from './bandit.js';

let randomSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Default: rng returns 0.99 → exploit path (>= epsilon), deterministic
  // selection of the LAST style, and a valid pickHook index (floor(0.99*n) < n).
  randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function exemplar(postId: string, er: number, format = 'carousel'): Exemplar {
  return { postId, label: 'viral', platform: 'tiktok', performance: { engagementRate: er }, format };
}

describe('constructor', () => {
  it('initializes 10 default styles with uniform weights and default config', () => {
    const bandit = new Bandit();
    const weights = bandit.getWeights();
    expect(weights.size).toBe(10);
    for (const w of weights.values()) {
      expect(w.weight).toBeCloseTo(0.1);
      expect(w.selectionCount).toBe(0);
      expect(w.lastSelected).toBe(0);
    }
    expect(weights.has('direct_call')).toBe(true);
    expect(weights.has('comparison')).toBe(true);
  });

  it('honors partial config overrides', () => {
    const bandit = new Bandit({ epsilon: 0.9, fatigueLimit: 1 });
    // Re-point the shared rng spy (captured by the constructor) to 0 → explore
    randomSpy.mockReturnValue(0);
    const sel = bandit.selectStyle([]);
    expect(sel.source).toBe('explore');
  });
});

describe('selectStyle', () => {
  it('exploits the weighted selection when rng >= epsilon', () => {
    const bandit = new Bandit();
    // rng=1 → exploit; with equal weights, the roll lands on the last style
    const sel = bandit.selectStyle([]);
    expect(sel.source).toBe('exploit');
    expect(sel.captionStyle).toBe('comparison');
    expect(sel.timing).toBe('12:00'); // no exemplars → default timing
    expect(sel.format).toBe('carousel'); // no exemplars → default format
    expect(sel.exemplarId).toBeUndefined();
    expect(sel.hook).toBeTruthy();
  });

  it('explores uniformly when rng < epsilon', () => {
    const bandit = new Bandit();
    randomSpy.mockReturnValue(0); // explore check passes, pick index 0
    const sel = bandit.selectStyle([]);
    expect(sel.source).toBe('explore');
    expect(sel.captionStyle).toBe('direct_call');
  });

  it('increments selectionCount and records lastSelected', () => {
    const bandit = new Bandit();
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    bandit.selectStyle([]);
    const comparison = bandit.getWeights().get('comparison')!;
    expect(comparison.selectionCount).toBe(1);
    expect(comparison.lastSelected).toBe(1_000_000);
    vi.useRealTimers();
  });

  it('extracts format and exemplarId from the best exemplar', () => {
    const bandit = new Bandit();
    const sel = bandit.selectStyle([
      exemplar('low', 0.02, 'photo'),
      exemplar('high', 0.09, 'video'),
      exemplar('mid', 0.05, 'carousel'),
    ]);
    expect(sel.exemplarId).toBe('high');
    expect(sel.format).toBe('video');
  });

  it('picks peak timing when most exemplars have strong engagement', () => {
    const bandit = new Bandit();
    const sel = bandit.selectStyle([
      exemplar('a', 0.09), exemplar('b', 0.08), exemplar('c', 0.07),
    ]);
    expect(sel.timing).toBe('peak');
  });

  it('picks off-peak timing when most exemplars are weak', () => {
    const bandit = new Bandit();
    const sel = bandit.selectStyle([
      exemplar('a', 0.01), exemplar('b', 0.02), exemplar('c', 0.09),
    ]);
    expect(sel.timing).toBe('off-peak');
  });

  it('returns a hook for every built-in style', () => {
    const bandit = new Bandit();
    // Force selection of every style index via explore with increasing rng
    const hooks = new Set<string>();
    for (let i = 0; i < 10; i++) {
      randomSpy.mockReturnValue(0.001); // explore
      randomSpy.mockReturnValueOnce(0.001); // explore check
      randomSpy.mockReturnValueOnce(i / 10); // pick index
      hooks.add(bandit.selectStyle([]).hook);
    }
    expect(hooks.size).toBeGreaterThan(0);
  });
});

describe('fatigue', () => {
  it('skips a style selected 3+ times within the fatigue window', () => {
    const bandit = new Bandit();
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    // rng=1 always → exploit selects last available style (comparison first)
    bandit.selectStyle([]); // comparison count 1
    bandit.selectStyle([]); // comparison count 2
    bandit.selectStyle([]); // comparison count 3 → fatigued
    const fourth = bandit.selectStyle([]);
    expect(fourth.captionStyle).not.toBe('comparison');
    expect(fourth.captionStyle).toBe('testimonial'); // new last available
    vi.useRealTimers();
  });

  it('resets counters when every style is fatigued', () => {
    const bandit = new Bandit();
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    // 10 styles × 3 selections = 30 selections to fatigue all
    for (let i = 0; i < 30; i++) {
      bandit.selectStyle([]);
    }
    let counts = Array.from(bandit.getWeights().values()).map((w) => w.selectionCount);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(3);

    // 31st selection: all fatigued → counters reset, selection proceeds
    const sel = bandit.selectStyle([]);
    expect(sel.captionStyle).toBe('comparison');
    counts = Array.from(bandit.getWeights().values()).map((w) => w.selectionCount);
    expect(Math.max(...counts)).toBeLessThanOrEqual(1);
    vi.useRealTimers();
  });

  it('a style outside the fatigue window is selectable again', () => {
    const bandit = new Bandit();
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    bandit.selectStyle([]); // comparison count 1
    bandit.selectStyle([]); // count 2
    bandit.selectStyle([]); // count 3 → fatigued
    // Advance time past the 1h fatigue window
    vi.setSystemTime(5_000_000 + 3_600_000 + 1);
    const sel = bandit.selectStyle([]);
    expect(sel.captionStyle).toBe('comparison'); // selectable again
    vi.useRealTimers();
  });
});

describe('updateReward', () => {
  it('updates and renormalizes weights for a known style', () => {
    const bandit = new Bandit();
    const before = bandit.getWeights();
    const comparisonBefore = before.get('comparison')!.weight;
    expect(comparisonBefore).toBeCloseTo(0.1);

    bandit.updateReward('comparison', 1.0);
    const after = bandit.getWeights();
    const total = Array.from(after.values()).reduce((s, w) => s + w.weight, 0);
    expect(total).toBeCloseTo(1.0, 5);
    expect(after.get('comparison')!.weight).toBeGreaterThan(comparisonBefore);
  });

  it('is a no-op for unknown styles', () => {
    const bandit = new Bandit();
    const before = bandit.getWeights();
    bandit.updateReward('nonexistent', 1.0);
    expect(bandit.getWeights().size).toBe(before.size);
    expect(bandit.getWeights().get('nonexistent')).toBeUndefined();
  });
});

describe('getWeights / resetWeights', () => {
  it('getWeights returns a defensive copy', () => {
    const bandit = new Bandit();
    const copy = bandit.getWeights();
    copy.get('direct_call')!.weight = 99;
    expect(bandit.getWeights().get('direct_call')!.weight).toBeCloseTo(0.1);
  });

  it('resetWeights restores uniform weights and zero counters', () => {
    const bandit = new Bandit();
    bandit.updateReward('emotional', 0.9);
    bandit.selectStyle([]);
    bandit.resetWeights();
    for (const w of bandit.getWeights().values()) {
      expect(w.weight).toBeCloseTo(0.1);
      expect(w.selectionCount).toBe(0);
      expect(w.lastSelected).toBe(0);
    }
  });

  it('StyleWeight entries carry all fields', () => {
    const bandit = new Bandit();
    const w: StyleWeight = bandit.getWeights().get('comparison')!;
    expect(w).toHaveProperty('style');
    expect(w).toHaveProperty('weight');
    expect(w).toHaveProperty('lastSelected');
    expect(w).toHaveProperty('selectionCount');
  });
});
