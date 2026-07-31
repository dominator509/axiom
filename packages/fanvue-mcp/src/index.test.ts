// ─── fanvue-mcp package exports — Vitest Suite ───
import { describe, it, expect } from 'vitest';
import * as pkg from './index.js';

describe('package exports', () => {
  it('exposes the client surface', () => {
    expect(typeof pkg.FanvueMcpClient).toBe('function');
    expect(typeof pkg.FanvueMcpError).toBe('function');
  });

  it('exposes the ToS engine surface', () => {
    expect(typeof pkg.ToSEngine).toBe('function');
    expect(pkg.DEFAULT_PLATFORM_THRESHOLDS).toBeDefined();
    expect(pkg.PLATFORM_RULES).toBeDefined();
  });

  it('exposes the TOKENKILLER surface', () => {
    expect(typeof pkg.TokenKillerAssembler).toBe('function');
    expect(typeof pkg.alignBlocks).toBe('function');
    expect(typeof pkg.cacheKey).toBe('function');
  });

  it('exposes the generator, vision, and prepost surfaces', () => {
    expect(typeof pkg.ContentGenerator).toBe('function');
    expect(typeof pkg.VisionEngineClient).toBe('function');
    expect(typeof pkg.PrePostHook).toBe('function');
  });
});
