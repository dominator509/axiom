import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], refs: [] as { current: unknown }[],
  stateIndex: 0, refIndex: 0, refresh: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
  useRef: (initial: unknown) => hooks.refs[hooks.refIndex++] ??= { current: initial },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
import VideoReview from './VideoReview';

beforeEach(() => { hooks.values = []; hooks.refs = []; hooks.refresh.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
function render(scanId = 'scan-1') {
  hooks.stateIndex = 0; hooks.refIndex = 0;
  const result = VideoReview({ bundleId: 'bundle-1', scanId, platforms: ['instagram', 'x'] });
  return result.props.children.at(-1);
}
function reviewed() {
  render();
  hooks.values[0] = ['instagram', 'x']; hooks.values[1] = true;
  hooks.values[2] = 'Reviewed every frame and the audio';
}
describe('explicit video review intent', () => {
  it('requires full-video attestation, each destination, and a rationale', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect(render().props.disabled).toBe(true);
    await render().props.onClick();
    reviewed(); hooks.values[0] = ['instagram'];
    expect(render().props.disabled).toBe(true);
    await render().props.onClick();
    hooks.values[0] = ['instagram', 'x']; hooks.values[1] = false;
    await render().props.onClick();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('submits only the explicit review intent and refreshes after confirmation', async () => {
    reviewed();
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    await render().props.onClick();
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/bundles/bundle-1/video-review');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ scanId: 'scan-1', platforms: ['instagram', 'x'],
      fullVideoAndAudioReviewed: true, reason: hooks.values[2] });
    expect(hooks.refresh).toHaveBeenCalledOnce();
  });
  it('reuses the intent key after a lost response but changes it for a new scan', async () => {
    reviewed();
    const fetcher = vi.fn().mockRejectedValue(new Error('lost response'));
    vi.stubGlobal('fetch', fetcher);
    await render().props.onClick();
    await render().props.onClick();
    const keys = () => fetcher.mock.calls.map(([, init]) => new Headers(init.headers).get('Idempotency-Key'));
    expect(new Set(keys()).size).toBe(1);
    expect(keys()[0]).toBeTruthy();
    await render('scan-2').props.onClick();
    expect(new Set(keys()).size).toBe(2);
    expect(hooks.refresh).not.toHaveBeenCalled();
  });
});
