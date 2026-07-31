// ─── LinktreeProvider — Vitest Suite ───
import { describe, it, expect, vi, afterEach } from 'vitest';
import { LinktreeProvider } from './linktree.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('LinktreeProvider', () => {
  it('reports kind linktree and disabled by default', () => {
    const p = new LinktreeProvider();
    expect(p.getKind()).toBe('linktree');
    expect(p.isEnabled()).toBe(false);
  });

  it('getProfile fetches from the configured base', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ handle: 'deziray' })));
    const p = new LinktreeProvider('https://linktree.test');
    const profile = await p.getProfile('model-1');
    expect(profile).toEqual({ handle: 'deziray' });
    const [url, init] = (vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit]);
    expect(url).toBe('https://linktree.test/profiles/model-1');
    expect(init.method).toBe('GET');
  });

  it('getProfile throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 401)));
    const p = new LinktreeProvider();
    await expect(p.getProfile('model-1')).rejects.toThrow('Linktree API error: 401');
  });

  it('updateProfile PUTs config and throws on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true })));
    const p = new LinktreeProvider('https://linktree.test');
    await p.updateProfile('model-1', { theme: 'dark' });
    const [url, init] = (vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit]);
    expect(url).toBe('https://linktree.test/profiles/model-1');
    expect(init.method).toBe('PUT');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    await expect(p.updateProfile('model-1', {})).rejects.toThrow('Linktree update error: 500');
  });

  it('getAnalytics returns [] on failure instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 502)));
    const p = new LinktreeProvider();
    await expect(p.getAnalytics('model-1')).resolves.toEqual([]);
  });
});
