import { describe, it, expect } from 'vitest';
import { embedFeatures } from './embedding.js';

describe('embedFeatures', () => {
  it('returns a 768-dim vector', () => {
    const v = embedFeatures({ platform: 'instagram', caption: 'hello world' });
    expect(v).toHaveLength(768);
  });

  it('is deterministic', () => {
    const f = { platform: 'tiktok', caption: 'dance', hashtags: ['#viral', '#fyp'] };
    expect(embedFeatures(f)).toEqual(embedFeatures(f));
  });

  it('is L2-normalized (or zero for empty features)', () => {
    const v = embedFeatures({ platform: 'x', caption: 'some text here' });
    const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
    expect(norm).toBeCloseTo(1, 5);

    const zero = embedFeatures({});
    expect(zero.every((x) => x === 0)).toBe(true);
  });

  it('different features give different embeddings', () => {
    const a = embedFeatures({ platform: 'instagram', caption: 'sunset' });
    const b = embedFeatures({ platform: 'instagram', caption: 'gym' });
    expect(a).not.toEqual(b);
  });

  it('handles nested objects and arrays', () => {
    const v = embedFeatures({
      platform: 'youtube',
      caption: 'long video',
      features: { hook: 'question', time: 'evening' },
      tags: ['a', 'b', 'c'],
    });
    expect(v).toHaveLength(768);
  });
});
