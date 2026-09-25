import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchGeneration } from './generation-status';

const bundle = { id: 'bundle-a', modelId: 'model-a', state: 'generated', assetId: null, tosReport: { verdict: 'pending' } };
const response = (data: unknown, extra: Record<string, unknown> = {}) => {
  const row = data as { state?: string; assetId?: string | null };
  const defaultJob = !row.assetId && ['generated', 'hold'].includes(row.state ?? '')
    ? { generationJob: { state: 'ready', attempts: 0, maxAttempts: 3, ageSeconds: 0 } } : {};
  return new Response(JSON.stringify({ data, ...defaultJob, ...extra }));
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('generation status polling', () => {
  it('reports a terminal scan failure once while preserving saved media', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { ...bundle, assetId: 'asset-a' }, scanFailed: true }));
    vi.stubGlobal('fetch', fetcher);
    const status = vi.fn(), unavailable = vi.fn();
    const stop = watchGeneration('bundle-a', 'model-a', status, unavailable);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(status).toHaveBeenCalledWith(expect.objectContaining({ assetReady: true, scanFailed: true, verdict: 'pending' }));
    expect(fetcher).toHaveBeenCalledOnce(); expect(unavailable).not.toHaveBeenCalled(); stop();
  });
  it.each(['true', 1, null])('rejects malformed scan failure %j', async scanFailed => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(bundle, { scanFailed, generationJob: { state: 'ready', attempts: 0, maxAttempts: 3, ageSeconds: 0 } })));
    const status = vi.fn(), unavailable = vi.fn();
    const stop = watchGeneration('bundle-a', 'model-a', status, unavailable);
    await vi.advanceTimersByTimeAsync(100);
    expect(status).not.toHaveBeenCalled(); expect(unavailable).toHaveBeenCalledOnce(); stop();
  });
  it.each(['true', 1, null])('rejects malformed pause state %j without claiming generation is active', async generationPaused => {
    const fetcher = vi.fn().mockResolvedValue(response(bundle, { generationPaused, generationJob: { state: 'ready', attempts: 0, maxAttempts: 3, ageSeconds: 0 } }));
    vi.stubGlobal('fetch', fetcher);
    const status = vi.fn(); const unavailable = vi.fn();
    const stop = watchGeneration('bundle-a', 'model-a', status, unavailable);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(status).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    stop();
  });
  it('reports a paused workspace and keeps observing without redispatching', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(bundle, { generationPaused: true, generationJob: { state: 'ready', attempts: 0, maxAttempts: 3, ageSeconds: 0 } }))
      .mockResolvedValueOnce(response({ ...bundle, state: 'hold' }, { generationPaused: false, generationJob: { state: 'dead', attempts: 3, maxAttempts: 3, ageSeconds: 0 } }));
    vi.stubGlobal('fetch', fetcher);
    const status = vi.fn(); const unavailable = vi.fn();
    const stop = watchGeneration('bundle-a', 'model-a', status, unavailable);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(status.mock.calls.map(([value]) => value.generationPaused)).toEqual([true, false]);
    expect(unavailable).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
    stop();
  });
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

  it('reports a terminal generation failure once without exposing error text', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(bundle, {
      generationJob: { state: 'dead', attempts: 3, maxAttempts: 3, ageSeconds: 600, lastError: 'provider token=secret' },
    }));
    vi.stubGlobal('fetch', fetcher);
    const status = vi.fn(), unavailable = vi.fn();
    const stop = watchGeneration('bundle-a', 'model-a', status, unavailable);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(status).toHaveBeenCalledWith(expect.objectContaining({ generationJob: { state: 'dead', attempts: 3, maxAttempts: 3, ageSeconds: 600 } }));
    expect(fetcher).toHaveBeenCalledOnce();
    expect(unavailable).not.toHaveBeenCalled();
    stop();
  });

  it('does not present an unverified pending state when the job snapshot is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: bundle })));
    const status = vi.fn(), unavailable = vi.fn();
    const stop = watchGeneration('bundle-a', 'model-a', status, unavailable);
    await vi.advanceTimersByTimeAsync(100);
    expect(status).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledOnce();
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
    const status = vi.fn(), unavailable = vi.fn();
    const stop = watchGeneration('bundle-a', 'model-a', status, unavailable);
    await vi.advanceTimersByTimeAsync(650_000);
    expect(fetcher).toHaveBeenCalledTimes(120);
    expect(status).toHaveBeenCalledTimes(120);
    expect(status.mock.calls.at(-1)?.[0]).toMatchObject({ generationJob: { state: 'ready' } });
    expect(unavailable).not.toHaveBeenCalled();
    stop();
  });
});
