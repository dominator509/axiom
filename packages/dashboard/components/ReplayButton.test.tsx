import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], refs: [] as { current: unknown }[],
  index: 0, refIndex: 0, refresh: vi.fn() }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
  useRef: (initial: unknown) => hooks.refs[hooks.refIndex++] ??= { current: initial },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
import ReplayButton from './ReplayButton';

beforeEach(() => { hooks.values = []; hooks.refs = []; hooks.refresh.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
function button(jobId = 'job-a') {
  hooks.index = 0; hooks.refIndex = 0;
  return ReplayButton({ jobId }).props.children[0].props.onClick as () => Promise<void>;
}
function key(fetch: ReturnType<typeof vi.fn>, index: number) {
  return new Headers(fetch.mock.calls[index][1].headers).get('Idempotency-Key');
}

it('recovers a lost response with the same request identity', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('response lost'));
  vi.stubGlobal('fetch', fetch);
  await button()();
  expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockResolvedValue(new Response('{}'));
  await button()();
  expect(key(fetch, 2)).toBe(key(fetch, 0));
  expect(hooks.refresh).toHaveBeenCalledOnce();
});

it('blocks a second click before React rerenders', async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { finish = resolve; }));
  vi.stubGlobal('fetch', fetch);
  const replay = button();
  const first = replay();
  const second = replay();
  const calls = fetch.mock.calls.length;
  finish(new Response('{}'));
  await Promise.all([first, second]);
  expect(calls).toBe(1);
});

it('uses a new identity for a different job', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('response lost'));
  vi.stubGlobal('fetch', fetch);
  await button('job-a')();
  fetch.mockResolvedValue(new Response('{}'));
  await button('job-b')();
  expect(key(fetch, 2)).not.toBe(key(fetch, 0));
});

it('allows a later replay intent after confirmed success with a new key', async () => {
  const fetch = vi.fn().mockImplementation(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  await button()();
  await button()();
  expect(key(fetch, 1)).not.toBe(key(fetch, 0));
});
