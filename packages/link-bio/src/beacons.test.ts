// ─── BeaconsProvider — Vitest Suite ───
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BeaconsProvider } from './beacons.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('BeaconsProvider', () => {
  it('reports kind beacons and disabled by default', () => {
    const p = new BeaconsProvider();
    expect(p.getKind()).toBe('beacons');
    expect(p.isEnabled()).toBe(false);
  });

  it('getProfile hits the /v1 profiles path', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ id: 'b1' })));
    const p = new BeaconsProvider('https://beacons.test');
    const profile = await p.getProfile('model-1');
    expect(profile).toEqual({ id: 'b1' });
    const [url, init] = (vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit]);
    expect(url).toBe('https://beacons.test/v1/profiles/model-1');
    expect(init.method).toBe('GET');
  });

  it('getProfile throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 403)));
    const p = new BeaconsProvider();
    await expect(p.getProfile('model-1')).rejects.toThrow('Beacons API error: 403');
  });

  it('updateProfile PUTs config and throws on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true })));
    const p = new BeaconsProvider('https://beacons.test');
    await p.updateProfile('model-1', { bio: 'hi' });
    const [url, init] = (vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit]);
    expect(url).toBe('https://beacons.test/v1/profiles/model-1');
    expect(init.method).toBe('PUT');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    await expect(p.updateProfile('model-1', {})).rejects.toThrow('Beacons update error: 500');
  });

  it('getAnalytics returns data and [] on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([{ clicks: 3, views: 9, date: '2026-07-30', source: 'beacons' }])));
    const p = new BeaconsProvider();
    const rows = await p.getAnalytics('model-1');
    expect(rows[0].source).toBe('beacons');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    await expect(p.getAnalytics('model-1')).resolves.toEqual([]);
  });
});
