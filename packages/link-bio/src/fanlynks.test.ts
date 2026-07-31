// ─── FanlynksProvider — Vitest Suite ───
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FanlynksProvider } from './fanlynks.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('FanlynksProvider', () => {
  it('reports kind fanlynks and disabled by default', () => {
    const p = new FanlynksProvider();
    expect(p.getKind()).toBe('fanlynks');
    expect(p.isEnabled()).toBe(false);
  });

  it('uses the configured base URL', () => {
    const p = new FanlynksProvider('https://api.fanlynks.test');
    expect((p as unknown as { baseUrl: string }).baseUrl).toBe('https://api.fanlynks.test');
  });

  it('getProfile fetches the profile JSON from the base URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ handle: 'deziray', name: 'Deziray' })));
    const p = new FanlynksProvider('https://api.fanlynks.test');
    const profile = await p.getProfile('model-1');
    expect(profile).toEqual({ handle: 'deziray', name: 'Deziray' });
    const [url, init] = (vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit]);
    expect(url).toBe('https://api.fanlynks.test/profiles/model-1');
    expect(init.method).toBe('GET');
  });

  it('getProfile throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'nope' }, 404)));
    const p = new FanlynksProvider();
    await expect(p.getProfile('model-1')).rejects.toThrow('Fanlynks API error: 404');
  });

  it('updateProfile PUTs the config to the profile endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true })));
    const p = new FanlynksProvider('https://api.fanlynks.test');
    await p.updateProfile('model-1', { displayName: 'Deziray' });
    const [url, init] = (vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit]);
    expect(url).toBe('https://api.fanlynks.test/profiles/model-1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ displayName: 'Deziray' });
  });

  it('updateProfile throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'x' }, 500)));
    const p = new FanlynksProvider();
    await expect(p.updateProfile('model-1', {})).rejects.toThrow('Fanlynks update error: 500');
  });

  it('getAnalytics returns rows sourced from fanlynks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([
      { clicks: 5, views: 20, date: '2026-07-30', source: 'fanlynks' },
    ])));
    const p = new FanlynksProvider();
    const rows = await p.getAnalytics('model-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('fanlynks');
    const [url] = (vi.mocked(fetch).mock.calls[0] as unknown as [string]);
    expect(url).toBe('https://api.fanlynks.example.com/profiles/model-1/analytics');
  });

  it('getAnalytics returns data and [] on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([{ clicks: 1, views: 2, date: '2026-07-30', source: 'fanlynks' }])));
    const p = new FanlynksProvider();
    const rows = await p.getAnalytics('model-1');
    expect(rows[0].source).toBe('fanlynks');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    await expect(p.getAnalytics('model-1')).resolves.toEqual([]);
  });
});
