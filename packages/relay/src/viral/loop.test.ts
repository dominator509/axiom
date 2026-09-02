// ─── ViralLoop — Vitest Suite ───
import { describe, it, expect } from 'vitest';
import { ViralLoop, type PostMetrics, type ViralLabel } from './loop.js';

function makeMetrics(
  postId: string,
  platform: string,
  er: number,
  overrides: Partial<PostMetrics> = {},
): PostMetrics {
  return {
    postId,
    platform,
    modelName: 'flux-pro',
    impressions: 1000,
    likes: 100,
    comments: 10,
    shares: 5,
    saves: 20,
    engagementRate: er,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('ingestMetrics / getMetrics', () => {
  it('stores metrics by postId', () => {
    const loop = new ViralLoop();
    loop.ingestMetrics('p1', makeMetrics('p1', 'tiktok', 0.03));
    expect(loop.getMetrics('p1')?.engagementRate).toBe(0.03);
    expect(loop.getMetrics('missing')).toBeUndefined();
  });

  it('overwrites metrics for the same postId', () => {
    const loop = new ViralLoop();
    loop.ingestMetrics('p1', makeMetrics('p1', 'tiktok', 0.02));
    loop.ingestMetrics('p1', makeMetrics('p1', 'tiktok', 0.08));
    expect(loop.getMetrics('p1')?.engagementRate).toBe(0.08);
  });
});

describe('labelPost', () => {
  it('returns baseline for unknown posts', () => {
    const loop = new ViralLoop();
    expect(loop.labelPost('nope')).toBe('baseline');
  });

  it('returns baseline before enough data to compute percentiles (< 4 posts)', () => {
    const loop = new ViralLoop();
    for (let i = 0; i < 3; i++) {
      loop.ingestMetrics(`p${i}`, makeMetrics(`p${i}`, 'tiktok', 0.01 * i));
    }
    expect(loop.labelPost('p0')).toBe('baseline');
  });

  it('labels posts viral/strong/baseline/weak against percentiles', () => {
    const loop = new ViralLoop();
    // engagement rates 0.01 .. 0.05 → p90=0.05, p70=0.04, p30=0.02
    for (let i = 1; i <= 5; i++) {
      loop.ingestMetrics(`p${i}`, makeMetrics(`p${i}`, 'tiktok', i / 100));
    }
    expect(loop.labelPost('p5')).toBe('viral'); // 0.05 >= p90
    expect(loop.labelPost('p4')).toBe('strong'); // 0.04 >= p70
    expect(loop.labelPost('p3')).toBe('baseline'); // 0.03 >= p30
    expect(loop.labelPost('p2')).toBe('baseline'); // 0.02 >= p30
    expect(loop.labelPost('p1')).toBe('weak'); // 0.01 < p30
  });

  it('computes percentiles per platform+modelName pair', () => {
    const loop = new ViralLoop();
    for (let i = 1; i <= 5; i++) {
      loop.ingestMetrics(`t${i}`, makeMetrics(`t${i}`, 'tiktok', i / 100));
      loop.ingestMetrics(
        `i${i}`,
        makeMetrics(`i${i}`, 'instagram', (10 - i) / 100, { modelName: 'sd3' }),
      );
    }
    // tiktok/flux-pro: p90 = 0.05 → t5 viral
    expect(loop.labelPost('t5')).toBe('viral');
    // instagram/sd3 rates 0.09,0.08,0.07,0.06,0.05 sorted asc: p90=0.09 → i1 viral
    expect(loop.labelPost('i1')).toBe('viral');
    expect(loop.labelPost('i5')).toBe('weak');
  });
});

describe('storeExemplar / getExemplarCount / retrieveExemplars', () => {
  it('stores an exemplar for a known post and skips unknown posts', () => {
    const loop = new ViralLoop();
    loop.ingestMetrics('p1', makeMetrics('p1', 'tiktok', 0.04));
    loop.storeExemplar('p1', 'strong');
    loop.storeExemplar('ghost', 'viral');
    expect(loop.getExemplarCount()).toBe(1);
  });

  it('exemplar captures performance and label', () => {
    const loop = new ViralLoop();
    const metrics = makeMetrics('p1', 'tiktok', 0.09);
    loop.ingestMetrics('p1', metrics);
    loop.storeExemplar('p1', 'viral');
    const exemplars = loop.retrieveExemplars('tiktok', 10);
    expect(exemplars).toHaveLength(1);
    expect(exemplars[0]).toMatchObject({ postId: 'p1', label: 'viral', platform: 'tiktok' });
    expect(exemplars[0].performance).toEqual(metrics);
  });

  it('retrieveExemplars filters platform and only viral/strong labels, sorted by engagement', () => {
    const loop = new ViralLoop();
    const posts = [
      { id: 'a', platform: 'tiktok', er: 0.05, label: 'viral' as ViralLabel },
      { id: 'b', platform: 'tiktok', er: 0.08, label: 'viral' as ViralLabel },
      { id: 'c', platform: 'tiktok', er: 0.04, label: 'strong' as ViralLabel },
      { id: 'd', platform: 'tiktok', er: 0.01, label: 'weak' as ViralLabel },
      { id: 'e', platform: 'instagram', er: 0.09, label: 'viral' as ViralLabel },
    ];
    for (const p of posts) {
      loop.ingestMetrics(p.id, makeMetrics(p.id, p.platform, p.er));
      loop.storeExemplar(p.id, p.label);
    }
    const result = loop.retrieveExemplars('tiktok', 10);
    expect(result.map((e) => e.postId)).toEqual(['b', 'a', 'c']); // sorted desc, weak excluded
  });

  it('respects the limit parameter', () => {
    const loop = new ViralLoop();
    for (let i = 1; i <= 5; i++) {
      const id = `p${i}`;
      loop.ingestMetrics(id, makeMetrics(id, 'tiktok', i / 100));
      loop.storeExemplar(id, 'viral');
    }
    expect(loop.retrieveExemplars('tiktok', 2)).toHaveLength(2);
    expect(loop.retrieveExemplars('tiktok', 0)).toHaveLength(0);
    expect(loop.retrieveExemplars('missing-platform', 10)).toHaveLength(0);
  });
});

describe('embedFeatures', () => {
  it('returns a normalized copy for cosine comparison', () => {
    const loop = new ViralLoop();
    const input = new Float32Array([0.1, 0.2, 0.3]);
    const out = loop.embedFeatures(input);
    expect(out).not.toBe(input);
    expect(Array.from(input)).toEqual(
      expect.arrayContaining([0.1, 0.2, 0.3].map((v) => expect.closeTo(v, 6))),
    );
    const norm = Math.sqrt(Array.from(out).reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 6);
    expect(out[0]).toBeCloseTo(0.26726124, 6);
    expect(out[1]).toBeCloseTo(0.5345225, 6);
    expect(out[2]).toBeCloseTo(0.8017837, 6);
  });

  it('preserves an all-zero feature vector', () => {
    const loop = new ViralLoop();
    expect(Array.from(loop.embedFeatures(new Float32Array([0, 0])))).toEqual([0, 0]);
  });
});
