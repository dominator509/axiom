import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const hooks = vi.hoisted(() => ({ state: null as unknown, effect: undefined as (() => () => void) | undefined }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: () => [hooks.state, (value: unknown) => { hooks.state = value; }],
  useEffect: (effect: () => () => void) => { hooks.effect = effect; },
}));
vi.mock('./LocaleProvider', () => ({ useLocale: () => ({ t: (key: string) => ({
  'safety.checking': 'Checking workspace safety status…',
  'safety.unavailable': 'Safety status unavailable',
  'safety.unavailableDescription': 'Publishing permission could not be confirmed. Reload or sign in again if this persists.',
  'safety.globalEnabled': '⚠ GLOBAL KILL SWITCH ENABLED',
  'safety.publishingHalted': 'Publishing is halted',
}[key] ?? key) }) }));
import KillSwitchBanner from './KillSwitchBanner';
let stop: (() => void) | undefined;
const fetcher = vi.fn();
const response = (enabled: unknown) => Response.json({ data: { enabled, reason: '' } });
beforeEach(() => { vi.useFakeTimers(); hooks.state = null; fetcher.mockReset(); vi.stubGlobal('fetch', fetcher); });
afterEach(() => { stop?.(); stop = undefined; vi.unstubAllGlobals(); vi.useRealTimers(); });
async function mount() { KillSwitchBanner(); stop = hooks.effect!(); await vi.advanceTimersByTimeAsync(0); }
it('refreshes an existing banner after an external safety-setting change', async () => {
  fetcher.mockResolvedValueOnce(response(false)).mockResolvedValue(response(true));
  await mount();
  expect(KillSwitchBanner()).toBeNull();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(renderToStaticMarkup(KillSwitchBanner())).toContain('Publishing is halted');
  expect(fetcher.mock.calls.every(([, init]) => init.cache === 'no-store' && !init.method)).toBe(true);
});
it.each([null, {}, { data: { enabled: 'false' } }])('does not hide an invalid status response: %j', async body => {
  fetcher.mockResolvedValue(Response.json(body));
  await mount();
  expect(renderToStaticMarkup(KillSwitchBanner())).toContain('Safety status unavailable');
});
it('shows unavailable after loss of access and stops polling an expired session', async () => {
  fetcher.mockResolvedValueOnce(response(false)).mockResolvedValue(new Response(null, { status: 401 }));
  await mount(); await vi.advanceTimersByTimeAsync(15_000);
  expect(renderToStaticMarkup(KillSwitchBanner())).toContain('Safety status unavailable');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('cancels polling on unmount', async () => {
  fetcher.mockResolvedValue(response(true)); await mount(); stop!();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetcher).toHaveBeenCalledOnce();
});
it('does not overlap requests or accept a late response after unmount', async () => {
  let resolve!: (response: Response) => void;
  fetcher.mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
  await mount(); await vi.advanceTimersByTimeAsync(20_000);
  expect(fetcher).toHaveBeenCalledOnce();
  const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
  stop!(); expect(signal.aborted).toBe(true);
  resolve(response(true)); await vi.advanceTimersByTimeAsync(0);
  expect(hooks.state).toBeNull();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetcher).toHaveBeenCalledOnce();
});
it('recovers from a transient failure without retaining a stale halted banner', async () => {
  fetcher.mockResolvedValueOnce(response(true)).mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(response(false));
  await mount();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(renderToStaticMarkup(KillSwitchBanner())).toContain('Safety status unavailable');
  await vi.advanceTimersByTimeAsync(15_000);
  expect(KillSwitchBanner()).toBeNull();
});
