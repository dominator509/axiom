// ─── PrePostHook — Vitest Suite ───
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrePostHook, type PrePostScript } from './prepost.js';

const INPUT = {
  targetPlatforms: ['tiktok' as const],
  captions: { tiktok: 'hello' },
  hashtags: ['fitness'],
  mediaUrls: ['https://cdn.test/a.jpg'],
  mode: 'api' as const,
};
const RESULT = {
  id: 'r1',
  bundleId: 'b1',
  results: [{ platform: 'tiktok' as const, remoteId: 'r1', state: 'published' as const }],
  publishedAt: '2026-07-31T00:00:00Z',
};

let hook: PrePostHook;

beforeEach(() => {
  hook = new PrePostHook();
});

describe('script registration', () => {
  it('registers, lists, and retrieves scripts', () => {
    const script: PrePostScript = { name: 'append-cta', beforePublish: async (i) => i, afterPublish: async () => {} };
    hook.registerScript(script);
    expect(hook.listScripts()).toEqual(['append-cta']);
    expect(hook.getScript('append-cta')).toBe(script);
    expect(hook.unregisterScript('append-cta')).toBe(true);
    expect(hook.listScripts()).toEqual([]);
  });

  it('rejects duplicate script names', () => {
    const script: PrePostScript = { name: 'dup', beforePublish: async (i) => i, afterPublish: async () => {} };
    hook.registerScript(script);
    expect(() => hook.registerScript({ ...script })).toThrow('already registered');
  });

  it('clearScripts empties the sandbox', () => {
    hook.registerScript({ name: 'a', beforePublish: async (i) => i, afterPublish: async () => {} });
    hook.clearScripts();
    expect(hook.listScripts()).toEqual([]);
  });
});

describe('beforePublish pipeline', () => {
  it('chains scripts in registration order, passing output forward', async () => {
    const first: PrePostScript = {
      name: 'first',
      beforePublish: async (i) => ({ ...i, captions: { ...i.captions, tiktok: `${i.captions.tiktok} one` } }),
      afterPublish: async () => {},
    };
    const second: PrePostScript = {
      name: 'second',
      beforePublish: async (i) => ({ ...i, captions: { ...i.captions, tiktok: `${i.captions.tiktok} two` } }),
      afterPublish: async () => {},
    };
    hook.registerScript(first);
    hook.registerScript(second);
    const out = await hook.beforePublish(INPUT, 'tiktok');
    expect(out.captions.tiktok).toBe('hello one two');
  });

  it('does not mutate the caller input', async () => {
    hook.registerScript({
      name: 'mutate',
      beforePublish: async (i) => ({ ...i, captions: { ...i.captions, tiktok: 'changed' } }),
      afterPublish: async () => {},
    });
    await hook.beforePublish(INPUT, 'tiktok');
    expect(INPUT.captions.tiktok).toBe('hello');
  });

  it('wraps script failures with the script name and platform', async () => {
    hook.registerScript({
      name: 'boom',
      beforePublish: async () => { throw new Error('kaboom'); },
      afterPublish: async () => {},
    });
    await expect(hook.beforePublish(INPUT, 'tiktok')).rejects.toThrow('PrePublish script "boom" failed for tiktok: kaboom');
  });
});

describe('afterPublish pipeline', () => {
  it('calls every afterPublish hook', async () => {
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    hook.registerScript({ name: 'a', beforePublish: async (i) => i, afterPublish: a });
    hook.registerScript({ name: 'b', beforePublish: async (i) => i, afterPublish: b });
    await hook.afterPublish(RESULT, 'tiktok');
    expect(a).toHaveBeenCalledWith(RESULT, 'tiktok');
    expect(b).toHaveBeenCalledWith(RESULT, 'tiktok');
  });

  it('swallows afterPublish failures (fire-and-forget)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    hook.registerScript({
      name: 'bad',
      beforePublish: async (i) => i,
      afterPublish: async () => { throw new Error('logged only'); },
    });
    await expect(hook.afterPublish(RESULT, 'tiktok')).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('bad'));
    error.mockRestore();
  });
});
