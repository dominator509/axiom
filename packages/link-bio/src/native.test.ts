// ─── NativeLinkBioProvider — Vitest Suite ───
import { describe, it, expect } from 'vitest';
import { NativeLinkBioProvider } from './native.js';

describe('NativeLinkBioProvider', () => {
  it('reports kind native and enabled by default', () => {
    const p = new NativeLinkBioProvider();
    expect(p.getKind()).toBe('native');
    expect(p.isEnabled()).toBe(true);
  });

  it('getProfile returns an HTML page for a model id', async () => {
    const p = new NativeLinkBioProvider();
    const profile = await p.getProfile('model-1');
    expect(typeof profile).toBe('string');
    expect(profile).toContain('model-1');
    expect(profile).toMatch(/<html/i);
  });

  it('updateProfile keeps the provider enabled unless explicitly disabled', async () => {
    const p = new NativeLinkBioProvider();
    await p.updateProfile('model-1', { theme: 'dark' });
    expect(p.isEnabled()).toBe(true);
    await p.updateProfile('model-1', { enabled: false });
    expect(p.isEnabled()).toBe(false);
  });

  it('getAnalytics returns today entry with zero counters from native source', async () => {
    const p = new NativeLinkBioProvider();
    const rows = await p.getAnalytics('model-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ clicks: 0, views: 0, source: 'native' });
    expect(rows[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
