import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchGeneration } from './generation-status';

const bundle = { id: 'bundle-a', modelId: 'model-a', state: 'generated', assetId: null, tosReport: { verdict: 'pending' } };
const response = (data: unknown) => new Response(JSON.stringify({ data }));
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('generation status polling', () => {
  it.each([true, false])('reports the measured exact-file hash result %s for the attached asset', async changed => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...bundle, assetId: 'asset-a',
      tosReport: { verdict: 'pass', sanitization: { assetId: 'asset-a', selected: true, exactFileHashChanged: changed } } })));
    const status = vi.fn(); const stop = watchGeneration('bundle-a', 'model-a', status, vi.fn());
    await vi.advanceTimersByTimeAsync(100);
    expect(status).toHaveBeenCalledWith(expect.objectContaining({ sanitization: { selected: true, exactFileHashChanged: changed } }));
    stop();
  });
  it.each([
    { assetId: 'old-asset', selected: true, exactFileHashChanged: true },
    { assetId: 'asset-a', selected: true, exactFileHashChanged: 'true' },
    { assetId: 'asset-a', selected: false, exactFileHashChanged: true },
  ])('does not report stale or malformed fingerprint evidence', async sanitization => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...bundle, assetId: 'asset-a', tosReport: { verdict: 'pass', sanitization } })));
    const status = vi.fn(); const stop = watchGeneration('bundle-a', 'model-a', status, vi.fn());
    await vi.advanceTimersByTimeAsync(100);
    expect(status.mock.calls[0][0]).not.toHaveProperty('sanitization'); stop();
  });
  it('follows queued, attached, then scanned state without issuing mutations', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(bundle))
      .mockResolvedValueOnce(response({ ...bundle, assetId: 'asset-a' }))
      .mockResolvedValueOnce(response({ ...bundle, assetId: 'asset-a', tosReport: { verdict: 'review' } }));
    vi.stubGlobal('fetch', fetcher);
    const status = vi.fn();
    const unavailable = vi.fn();
    const stop = watchGeneration('bundle-a', 'model-a', status, unavailable);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(status.mock.calls.map(([value]) => [value.assetReady, value.verdict]))
      .toEqual([[false, 'pending'], [true, 'pending'], [true, 'review']]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [url, options] of fetcher.mock.calls) {
      expect(url).toBe('/api/v1/bundles/bundle-a');
      expect(options.method).toBeUndefined();
      expect(options.cache).toBe('no-store');
    }
    expect(unavailable).not.toHaveBeenCalled();
    stop();
  });

  it.each([
    new Response('', { status: 401 }),
    response({ ...bundle, modelId: 'another-model' }),
    response({ ...bundle, tosReport: { verdict: 'unknown' } }),
  ])('stops on unavailable or mismatched status without claiming generation failed', async result => {
    const fetcher = vi.fn().mockResolvedValue(result);
    vi.stubGlobal('fetch', fetcher);
    const status = vi.fn();
    const unavailable = vi.fn();
    const stop = watchGeneration('bundle-a', 'model-a', status, unavailable);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(status).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    stop();
  });

  it('aborts an in-flight read on unmount and ignores its late response', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetcher);
    const status = vi.fn();
    const unavailable = vi.fn();
    const stop = watchGeneration('bundle-a', 'model-a', status, unavailable);
    stop();
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    finish(response(bundle));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(status).not.toHaveBeenCalled();
    expect(unavailable).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('bounds polling when a worker never completes', async () => {
    const fetcher = vi.fn().mockImplementation(async () => response(bundle));
    vi.stubGlobal('fetch', fetcher);
    const unavailable = vi.fn();
    const stop = watchGeneration('bundle-a', 'model-a', vi.fn(), unavailable);
    await vi.advanceTimersByTimeAsync(650_000);
    expect(fetcher).toHaveBeenCalledTimes(120);
    expect(unavailable).toHaveBeenCalledOnce();
    stop();
  });
});
