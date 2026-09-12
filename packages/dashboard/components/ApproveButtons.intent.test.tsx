import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const hooks = vi.hoisted(() => ({
  values: [] as unknown[], refs: [] as { current: unknown }[], stateIndex: 0, refIndex: 0,
  refresh: vi.fn(),
}));
// Real handler/transport tests with controlled hooks; browser acceptance is separate.
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
  useRef: (initial: unknown) => hooks.refs[hooks.refIndex++] ??= { current: initial },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
import ApproveButtons from './ApproveButtons';

beforeEach(() => {
  hooks.values = [];
  hooks.values[3] = 'Make the caption clearer';
  hooks.refs = [];
  hooks.refresh.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function buttons(revisionId = 'revision-a') {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  const element = ApproveButtons({
    bundleId: 'bundle', revisionId, tosBlocked: false, platforms: ['threads'],
    connections: [{ id: 'account', modelId: 'model', platform: 'threads', status: 'connected',
      displayName: 'Account', capabilities: [], connectedAt: '2026-01-01' }],
  });
  const actions = element.props.children.at(-1).props.children as ReactElement<{ onClick: () => Promise<void> }>[];
  return actions.map((button) => button.props.onClick);
}
function key(fetch: ReturnType<typeof vi.fn>, index: number) {
  return new Headers(fetch.mock.calls[index][1].headers).get('Idempotency-Key');
}

describe('review action intent', () => {
  it('can recover an unchanged scheduled approval after its slot has passed', async () => {
    const slot = new Date(2030, 0, 15, 12, 0);
    vi.spyOn(Date, 'now').mockReturnValue(slot.getTime() - 60_000);
    hooks.values[2] = '2030-01-15T12:00';
    const fetch = vi.fn().mockRejectedValue(new Error('response lost'));
    vi.stubGlobal('fetch', fetch);
    await buttons()[0]();
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.mocked(Date.now).mockReturnValue(slot.getTime() + 60_000);
    fetch.mockResolvedValue(new Response('{}'));
    await buttons()[0]();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(key(fetch, 2)).toBe(key(fetch, 0));
    expect(fetch.mock.calls[2][1].body).toBe(fetch.mock.calls[0][1].body);
    expect(hooks.refresh).toHaveBeenCalledOnce();
  });

  it('still rejects a past slot when the reviewed revision changes after a lost response', async () => {
    const slot = new Date(2030, 0, 15, 12, 0);
    vi.spyOn(Date, 'now').mockReturnValue(slot.getTime() - 60_000);
    hooks.values[2] = '2030-01-15T12:00';
    const fetch = vi.fn().mockRejectedValue(new Error('response lost'));
    vi.stubGlobal('fetch', fetch);
    await buttons('revision-a')[0]();
    vi.mocked(Date.now).mockReturnValue(slot.getTime() + 60_000);
    await buttons('revision-b')[0]();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(hooks.values[6]).toContain('future');
  });

  it('does not retain the expired-slot exception after confirmed success', async () => {
    const slot = new Date(2030, 0, 15, 12, 0);
    vi.spyOn(Date, 'now').mockReturnValue(slot.getTime() - 60_000);
    hooks.values[2] = '2030-01-15T12:00';
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await buttons()[0]();
    vi.mocked(Date.now).mockReturnValue(slot.getTime() + 60_000);
    await buttons()[0]();
    expect(fetch).toHaveBeenCalledOnce();
    expect(hooks.values[6]).toContain('future');
  });

  it.each([0, 1, 2])('retains the key after exhausted transport retries for action %s', async (index) => {
    const fetch = vi.fn().mockRejectedValue(new Error('response lost'));
    vi.stubGlobal('fetch', fetch);
    await buttons()[index]();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(hooks.values[5]).toBe(false);
    expect(hooks.values[6]).toEqual(expect.stringContaining('could not be confirmed'));
    fetch.mockResolvedValue(new Response('{}'));
    await buttons()[index]();
    expect(key(fetch, 0)).toBeTruthy();
    expect(key(fetch, 2)).toBe(key(fetch, 0));
    expect(hooks.refresh).toHaveBeenCalledOnce();
  });

  it('blocks a conflicting action while approval is in flight', async () => {
    let finish!: (response: Response) => void;
    const fetch = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal('fetch', fetch);
    const [approve, , reject] = buttons();
    const pending = approve();
    await reject();
    expect(fetch).toHaveBeenCalledOnce();
    finish(new Response('{}'));
    await pending;
  });

  it('does not reuse a key for a new reviewed revision', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('response lost'));
    vi.stubGlobal('fetch', fetch);
    await buttons('revision-a')[2]();
    fetch.mockResolvedValue(new Response('{}'));
    await buttons('revision-b')[2]();
    expect(key(fetch, 2)).not.toBe(key(fetch, 0));
  });
});
