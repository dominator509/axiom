import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  set: vi.fn(), replace: vi.fn(), refresh: vi.fn(), inFlight: { current: false },
}));
// Exercise the real event handler with controlled hooks; these are not browser tests.
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => [initial, state.set],
  useRef: () => state.inFlight,
}));
vi.mock('next/navigation', () => ({ useRouter: () => state }));

import SignOutButton from './SignOutButton';

beforeEach(() => {
  vi.clearAllMocks();
  state.inFlight.current = false;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function click() {
  const element = SignOutButton();
  return element.props.children[0].props.onClick as () => Promise<void>;
}

describe('sign-out handler', () => {
  it('navigates only after a successful revocation response', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await click()();
    expect(fetch).toHaveBeenCalledWith('/api/auth/sign-out', expect.objectContaining({
      method: 'POST', body: '{}', signal: expect.any(AbortSignal),
    }));
    expect(state.replace).toHaveBeenCalledWith('/login');
    expect(state.refresh).toHaveBeenCalledOnce();
    expect(state.set).toHaveBeenLastCalledWith(false);
  });

  it.each([401, 403, 500])('keeps HTTP %s failures visible and retryable', async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal('fetch', fetch);
    const handler = click();
    await handler();
    expect(state.replace).not.toHaveBeenCalled();
    expect(state.refresh).not.toHaveBeenCalled();
    expect(state.set).toHaveBeenCalledWith(expect.stringContaining('session may still be active'));
    expect(state.set).toHaveBeenLastCalledWith(false);
    fetch.mockResolvedValue(new Response(null, { status: 200 }));
    await handler();
    expect(state.replace).toHaveBeenCalledWith('/login');
  });

  it('handles network rejection without claiming success or leaking an unhandled rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(click()()).resolves.toBeUndefined();
    expect(state.replace).not.toHaveBeenCalled();
    expect(state.set).toHaveBeenCalledWith(expect.stringContaining('Please try again'));
    expect(state.inFlight.current).toBe(false);
  });

  it('bounds a hung request and enables retry after timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    })));
    const pending = click()();
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    expect(state.replace).not.toHaveBeenCalled();
    expect(state.set).toHaveBeenCalledWith(expect.stringContaining('could not be confirmed'));
    expect(state.set).toHaveBeenLastCalledWith(false);
    expect(state.inFlight.current).toBe(false);
  });

  it('suppresses repeated clicks until the pending request settles', async () => {
    let finish!: (response: Response) => void;
    const fetch = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal('fetch', fetch);
    const handler = click();
    const pending = handler();
    await handler();
    expect(fetch).toHaveBeenCalledOnce();
    expect(state.replace).not.toHaveBeenCalled();
    finish(new Response(null, { status: 200 }));
    await pending;
    expect(state.inFlight.current).toBe(false);
  });
});
