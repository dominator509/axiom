import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { FormEvent } from 'react';

const hooks = vi.hoisted(() => ({
  values: [] as unknown[], refs: [] as { current: unknown }[], stateIndex: 0, refIndex: 0,
  refresh: vi.fn(),
}));
// Controlled hooks exercise the component's real handler and mutation transport, not a browser.
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useEffect: () => {},
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.refIndex++;
    return hooks.refs[index] ??= { current: initial };
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));

import NewModelForm from './NewModelForm';

beforeEach(() => {
  hooks.values = [true, 'Creator', 'creator', 'Bio', null, false];
  hooks.refs = [];
  hooks.refresh.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

function submit() {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  const element = NewModelForm();
  const handler = element.props.children.props.onSubmit as (event: FormEvent) => Promise<void>;
  return () => handler({ preventDefault: vi.fn() } as unknown as FormEvent);
}

function key(fetch: ReturnType<typeof vi.fn>, index: number) {
  return new Headers(fetch.mock.calls[index][1].headers).get('Idempotency-Key');
}

describe('profile creation intent', () => {
  it('prevents overlapping submissions before rerender and releases controls on success', async () => {
    let finish!: (response: Response) => void;
    const fetch = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal('fetch', fetch);
    const handler = submit();
    const pending = handler();
    await handler();
    expect(fetch).toHaveBeenCalledOnce();
    expect(hooks.values[5]).toBe(true);
    finish(new Response('{}', { status: 201 }));
    await pending;
    expect(hooks.values[5]).toBe(false);
    expect(hooks.values[0]).toBe(false);
    expect(hooks.refresh).toHaveBeenCalledOnce();
  });

  it('reuses the same key when the user retries after all network attempts fail', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('response lost'));
    vi.stubGlobal('fetch', fetch);
    await submit()();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(hooks.values[4]).toEqual(expect.stringContaining('could not be confirmed'));
    expect(hooks.values[5]).toBe(false);
    expect(hooks.refresh).not.toHaveBeenCalled();
    fetch.mockResolvedValue(new Response('{}', { status: 201 }));
    await submit()();
    expect(key(fetch, 0)).toBeTruthy();
    expect(key(fetch, 1)).toBe(key(fetch, 0));
    expect(key(fetch, 2)).toBe(key(fetch, 0));
  });

  it('uses a new identity when validation is corrected with a changed payload', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"error":{"message":"Invalid name"}}', { status: 400 }));
    vi.stubGlobal('fetch', fetch);
    await submit()();
    expect(hooks.values[4]).toBe('Invalid name');
    expect(hooks.values[5]).toBe(false);
    hooks.values[1] = 'Corrected creator';
    fetch.mockResolvedValue(new Response('{}', { status: 201 }));
    await submit()();
    expect(key(fetch, 1)).not.toBe(key(fetch, 0));
  });
});
