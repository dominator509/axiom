import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  values: [] as unknown[], index: 0,
  effect: null as (() => (() => void)) | null,
}));
// Exercise the real preview effect and event handlers; browser playback remains
// a separate runtime check, not a claim made by these controlled-hook tests.
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value;
    }];
  },
  useEffect: (effect: () => (() => void)) => { hooks.effect = effect; },
}));
import BundleMedia from './BundleMedia';

function render(bundleId = 'bundle-a') {
  hooks.index = 0;
  return BundleMedia({ bundleId });
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const cleanups: Array<() => void> = [];
function mount(bundleId = 'bundle-a') {
  render(bundleId);
  cleanups.push(hooks.effect!());
}
beforeEach(() => { hooks.values = []; hooks.effect = null; });
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('saved media preview recovery', () => {
  it.each(['image/jpeg', 'video/mp4'])('prevents flex stretching and preserves %s preview proportions', async type => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { headers: { 'content-type': type } })));
    mount(); await flush();
    expect(render().props.style).toMatchObject({ alignSelf: 'center', width: 'auto', height: 'auto', objectFit: 'contain', maxWidth: '100%', maxHeight: 480 });
  });
  it('retries only the authenticated saved-media HEAD request after failure', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { headers: { 'content-type': 'video/mp4' } }));
    vi.stubGlobal('fetch', fetch);
    mount(); await flush();
    const error = render();
    const button = error.props.children.find((child: { type?: string }) => child?.type === 'button');
    expect(button.props.children).toBe('Retry media preview');
    button.props.onClick();
    expect(render().props.children).toContain('Loading media preview');
    mount(); await flush();
    const video = render();
    expect(video.type).toBe('video');
    expect(video.props.playsInline).toBe(true);
    expect(video.props.controls).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetch.mock.calls) {
      expect(url).toBe('/api/v1/bundles/bundle-a/media');
      expect(options).toMatchObject({ method: 'HEAD', cache: 'no-store' });
    }
  });

  it('offers recovery when image byte loading fails after a successful HEAD', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { headers: { 'content-type': 'image/png' } })));
    mount(); await flush();
    const image = render();
    expect(image.type).toBe('img');
    image.props.onError();
    expect(render().props.children[1].props.children).toBe('Retry media preview');
  });

  it('rejects non-media responses such as a redirected login page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { headers: { 'content-type': 'text/html' } })));
    mount(); await flush();
    expect(render().props.children[0].props.children).toContain('Media preview unavailable');
  });

  it('ignores an old bundle response after cleanup', async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>(resolve => { finish = resolve; })));
    mount(); cleanups.pop()!();
    finish(new Response(null, { headers: { 'content-type': 'video/mp4' } }));
    await flush();
    expect(hooks.values[0]).toBe(null);
    expect(hooks.values[1]).toBe(false);
  });

  it('ends a hung preview request at the deadline and permits manual retry', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })));
    mount();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(render().props.children[1].props.children).toBe('Retry media preview');
  });
});
