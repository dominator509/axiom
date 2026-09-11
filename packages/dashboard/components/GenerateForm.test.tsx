import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormEvent } from 'react';

const hooks = vi.hoisted(() => ({
  values: [] as unknown[], refs: [] as { current: unknown }[], stateIndex: 0, refIndex: 0,
  refresh: vi.fn(),
}));
// Exercise the real handler and mutation client with controlled hooks, not browser automation.
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
  useRef: (initial: unknown) => hooks.refs[hooks.refIndex++] ??= { current: initial },
  useEffect: () => {},
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
import GenerateForm from './GenerateForm';

beforeEach(() => { hooks.values = []; hooks.refs = []; hooks.refresh.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

function submit(modelId = 'model-a') {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  const element = GenerateForm({ modelId });
  const handler = element.props.children.find((child: { type?: unknown }) => child?.type === 'form').props.onSubmit as (event: FormEvent) => Promise<void>;
  return () => handler({ preventDefault: vi.fn() } as unknown as FormEvent);
}
function response() {
  return new Response(JSON.stringify({ data: { variants: [], tosReport: { verdict: 'review', scores: [] } } }));
}
function key(fetch: ReturnType<typeof vi.fn>, index: number) {
  return new Headers(fetch.mock.calls[index][1].headers).get('Idempotency-Key');
}

describe('generation intent', () => {
  it.each(['image', 'video'])('submits the %s media contract with the same retry key', async kind => {
    submit(); // Initialize the controlled hook state.
    hooks.values[11] = kind;
    hooks.values[12] = 'A landscape';
    hooks.values[13] = '11111111-1111-4111-8111-111111111111';
    hooks.values[14] = 10;
    const fetch = vi.fn().mockRejectedValue(new Error('response lost'));
    vi.stubGlobal('fetch', fetch);
    await submit()();
    fetch.mockResolvedValue(response());
    await submit()();
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.media).toEqual(kind === 'image'
      ? { kind, prompt: 'A landscape', aspectRatio: '4:5' }
      : { kind, prompt: 'A landscape', sourceAssetId: hooks.values[13], duration: 10 });
    expect(body).not.toHaveProperty('userId');
    expect(key(fetch, 2)).toBe(key(fetch, 0));
  });
  it('does not submit video without a selected source image', async () => {
    submit();
    hooks.values[11] = 'video';
    hooks.values[12] = 'Animate this';
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await submit()();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reuses the same model and payload key after lost responses', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('response lost'));
    vi.stubGlobal('fetch', fetch);
    await submit()();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(hooks.values[9]).toEqual(expect.stringContaining('could not be confirmed'));
    fetch.mockResolvedValue(response());
    await submit()();
    expect(key(fetch, 0)).toBeTruthy();
    expect(key(fetch, 1)).toBe(key(fetch, 0));
    expect(key(fetch, 2)).toBe(key(fetch, 0));
    expect(hooks.refresh).toHaveBeenCalledOnce();
  });

  it('suppresses overlapping submits and releases busy state', async () => {
    let finish!: (response: Response) => void;
    const fetch = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal('fetch', fetch);
    const handler = submit();
    const pending = handler();
    await handler();
    expect(fetch).toHaveBeenCalledOnce();
    expect(hooks.values[8]).toBe(true);
    finish(response());
    await pending;
    expect(hooks.values[8]).toBe(false);
  });

  it.each(['model', 'payload'])('starts a distinct intent when the %s changes', async (change) => {
    const fetch = vi.fn().mockRejectedValue(new Error('response lost'));
    vi.stubGlobal('fetch', fetch);
    await submit()();
    if (change === 'payload') hooks.values[0] = 'outdoor';
    fetch.mockResolvedValue(response());
    await submit(change === 'model' ? 'model-b' : 'model-a')();
    expect(key(fetch, 2)).not.toBe(key(fetch, 0));
  });
});
