import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  index: 0,
  refIndex: 0,
  refresh: vi.fn(),
}));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
  useRef: (initial: unknown) => hooks.refs[hooks.refIndex++] ??= { current: initial },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({ t: (key: string) => ({
    'incidents.discard': 'Discard',
    'incidents.discardConfirm': 'Discard this failed job?',
    'incidents.discarded': 'Discarded',
    'incidents.discardFailed': 'Discard failed',
    'incidents.discardNotConfirmed': 'Discard was not confirmed',
  }[key] ?? key) }),
}));
import DiscardButton from './DiscardButton';

beforeEach(() => {
  hooks.values = [];
  hooks.refs = [];
  hooks.refresh.mockReset();
  vi.stubGlobal('confirm', vi.fn(() => true));
});
afterEach(() => vi.unstubAllGlobals());

function discardHandler(jobId = 'job-a') {
  hooks.index = 0;
  hooks.refIndex = 0;
  return DiscardButton({ jobId }).props.children[0].props.onClick as () => Promise<void>;
}
function key(fetch: ReturnType<typeof vi.fn>, index: number) {
  return new Headers(fetch.mock.calls[index][1].headers).get('Idempotency-Key');
}

it('asks before discarding and sends the confirmed job through the idempotent API', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  await discardHandler()();
  expect(globalThis.confirm).toHaveBeenCalledWith('Discard this failed job?');
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/incidents/job-a/discard');
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST' });
  expect(hooks.refresh).toHaveBeenCalledOnce();
});

it('does not send a request when the operator cancels confirmation', async () => {
  vi.stubGlobal('confirm', vi.fn(() => false));
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await discardHandler()();
  expect(fetch).not.toHaveBeenCalled();
  expect(hooks.refresh).not.toHaveBeenCalled();
});

it('reuses the same request identity after an uncertain response', async () => {
  const fetch = vi.fn()
    .mockRejectedValueOnce(new Error('response lost'))
    .mockRejectedValueOnce(new Error('retry response lost'))
    .mockResolvedValueOnce(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  await discardHandler()();
  await discardHandler()();
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(key(fetch, 1)).toBe(key(fetch, 0));
  expect(key(fetch, 2)).toBe(key(fetch, 0));
  expect(hooks.refresh).toHaveBeenCalledOnce();
});

it('ignores concurrent clicks and gives a new job a separate identity', async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.fn().mockReturnValue(new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', fetch);
  const discard = discardHandler();
  const first = discard();
  const second = discard();
  expect(fetch).toHaveBeenCalledTimes(1);
  finish(new Response('{}'));
  await Promise.all([first, second]);
  fetch.mockRejectedValue(new Error('response lost'));
  await discardHandler('job-b')();
  expect(key(fetch, 1)).not.toBe(key(fetch, 0));
});
