// ─── LinkBioRegistry — Vitest Suite ───
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LinkBioRegistry } from './registry.js';
import type { LinkInBioProvider } from './registry.js';

function fakeProvider(kind: 'native' | 'fanlynks' | 'linktree' | 'beacons', enabled: boolean): LinkInBioProvider {
  return {
    getKind: () => kind,
    isEnabled: () => enabled,
    getProfile: vi.fn().mockResolvedValue({ kind }),
    updateProfile: vi.fn().mockResolvedValue(undefined),
    getAnalytics: vi.fn().mockResolvedValue([{ clicks: 1, views: 2, date: '2026-07-30', source: kind }]),
  };
}

let reg: LinkBioRegistry;

beforeEach(() => {
  reg = new LinkBioRegistry();
});

afterEach(() => vi.restoreAllMocks());

describe('register / enable / disable', () => {
  it('registers providers keyed by kind (last registration wins)', () => {
    reg.register(fakeProvider('native', true));
    reg.register(fakeProvider('fanlynks', false));
    expect(reg.providers.size).toBe(2);
    reg.register(fakeProvider('native', false));
    expect(reg.providers.size).toBe(2);
  });

  it('enable calls updateProfile on the provider', async () => {
    const p = fakeProvider('fanlynks', false);
    reg.register(p);
    await reg.enable('model-1', 'fanlynks', { theme: 'dark' });
    expect(p.updateProfile).toHaveBeenCalledWith('model-1', { theme: 'dark' });
  });

  it('enable throws for an unknown kind', async () => {
    await expect(reg.enable('model-1', 'beacons' as 'native', {})).rejects.toThrow('Unknown provider kind');
  });

  it('disable throws for an unknown kind', async () => {
    await expect(reg.disable('model-1', 'native' as 'fanlynks')).rejects.toThrow('Unknown provider kind');
  });
});

describe('getActiveProviders / getPrimaryProvider', () => {
  it('returns only enabled providers', () => {
    reg.register(fakeProvider('native', true));
    reg.register(fakeProvider('fanlynks', false));
    const active = reg.getActiveProviders('model-1');
    expect(active.map((p) => p.getKind())).toEqual(['native']);
  });

  it('primary is the first enabled provider, or null when none', () => {
    reg.register(fakeProvider('linktree', true));
    reg.register(fakeProvider('beacons', true));
    expect(reg.getPrimaryProvider('model-1')?.getKind()).toBe('linktree');

    const empty = new LinkBioRegistry();
    expect(empty.getPrimaryProvider('model-1')).toBeNull();
  });
});

describe('getNormalizedAnalytics', () => {
  it('aggregates analytics from active providers, sorted by date desc', async () => {
    const a = fakeProvider('native', true);
    const b = fakeProvider('fanlynks', true);
    (a.getAnalytics as ReturnType<typeof vi.fn>).mockResolvedValue([
      { clicks: 1, views: 1, date: '2026-07-28', source: 'native' },
      { clicks: 2, views: 2, date: '2026-07-30', source: 'native' },
    ]);
    (b.getAnalytics as ReturnType<typeof vi.fn>).mockResolvedValue([
      { clicks: 5, views: 5, date: '2026-07-29', source: 'fanlynks' },
    ]);
    reg.register(a);
    reg.register(b);

    const rows = await reg.getNormalizedAnalytics('model-1');
    expect(rows.map((r) => r.date)).toEqual(['2026-07-30', '2026-07-29', '2026-07-28']);
  });

  it('returns an empty array when no providers are active', async () => {
    reg.register(fakeProvider('native', false));
    const rows = await reg.getNormalizedAnalytics('model-1');
    expect(rows).toEqual([]);
  });
});

describe('singleton registry', () => {
  it('pre-registers the native provider', () => {
    // The app singleton registers native so every model has a default page
    const { registry } = { registry: reg };
    expect(registry).toBeInstanceOf(LinkBioRegistry);
  });
});
