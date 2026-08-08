// ─── TOKENKILLER — Vitest Suite ───
import { describe, it, expect } from 'vitest';
import {
  alignBlocks,
  cacheKey,
  TokenKillerAssembler,
  type TokenKillerSegments,
} from './tokenkiller.js';

describe('alignBlocks', () => {
  it('returns text unchanged when already aligned to 64 tokens', () => {
    // ~4 chars/token → 256 chars ≈ 64 tokens exactly
    const text = 'a'.repeat(256);
    expect(alignBlocks(text)).toBe(text);
  });

  it('pads with spaces to the next 64-token boundary', () => {
    const text = 'a'.repeat(100);
    const out = alignBlocks(text);
    expect(out.length).toBeGreaterThan(100);
    // 100 chars ≈ 25 tokens → pad to 64 tokens = 256 chars
    expect(out.length).toBe(256);
    expect(out.slice(100)).toMatch(/^ +$/);
  });

  it('handles empty strings', () => {
    expect(alignBlocks('')).toBe('');
  });
});

describe('cacheKey', () => {
  it('produces a deterministic 16-char hex key', () => {
    const a = cacheKey('model-1', 'tiktok');
    const b = cacheKey('model-1', 'tiktok');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).toBe(b);
  });

  it('varies by model, platform, and prefix version', () => {
    const base = cacheKey('m1', 'x');
    expect(cacheKey('m2', 'x')).not.toBe(base);
    expect(cacheKey('m1', 'instagram')).not.toBe(base);
    expect(cacheKey('m1', 'x', '9.9.9')).not.toBe(base);
  });
});

describe('TokenKillerAssembler', () => {
  const segments: TokenKillerSegments = {
    S0: 'You are a creator assistant.',
    S1: 'No explicit content on tiktok.',
    S2: 'example post',
    S3: 'Caption: hello world',
  };

  it('defaults to the current prefix version', () => {
    expect(new TokenKillerAssembler().getVersion()).toBe('1.0.0');
  });

  it('applies partial version overrides', () => {
    const a = new TokenKillerAssembler({ minor: 2 });
    expect(a.getVersion()).toBe('1.2.0');
  });

  it('assembles segments in order with delimiters', () => {
    const out = new TokenKillerAssembler().segmentPrompt(segments);
    expect(out.indexOf('[SYSTEM]')).toBeLessThan(out.indexOf('[PLAYBOOK]'));
    expect(out.indexOf('[PLAYBOOK]')).toBeLessThan(out.indexOf('[EXEMPLARS]'));
    expect(out.indexOf('[EXEMPLARS]')).toBeLessThan(out.indexOf('[TASK]'));
    expect(out).toContain('You are a creator assistant.');
    expect(out).toContain('No explicit content on tiktok.');
  });

  it('skips empty segments', () => {
    const out = new TokenKillerAssembler().segmentPrompt({
      S0: '',
      S1: '',
      S2: '',
      S3: 'only task',
    });
    expect(out).not.toContain('[SYSTEM]');
    expect(out).not.toContain('[PLAYBOOK]');
    expect(out).not.toContain('[EXEMPLARS]');
    expect(out).toContain('[TASK]');
    expect(out).toContain('only task');
  });

  it('block-aligns the assembled prefix', () => {
    const out = new TokenKillerAssembler().segmentPrompt(segments);
    const estimatedTokens = Math.ceil(out.length / 4);
    expect(estimatedTokens % 64).toBe(0);
  });
});
