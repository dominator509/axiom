import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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
const bundleId = '22222222-2222-4222-8222-222222222222';
const revision = '33333333-3333-4333-8333-333333333333';
function success(path: string) {
  const state = { approve: 'approved', revise: 'revising', reject: 'rejected' }[path.split('/').at(-1)!];
  return new Response(JSON.stringify({ data: { id: bundleId, state,
    tosReport: { verdict: state === 'revising' ? 'pending' : 'pass', revisionId: revision } } }));
}
let latestView: ReactElement;

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
    bundleId, revisionId, tosBlocked: false, platforms: ['threads'],
    connections: [{ id: 'account', modelId: 'model', platform: 'threads', status: 'connected',
      displayName: 'Account', capabilities: [], connectedAt: '2026-01-01' }],
  });
  latestView = element;
  const actions = element.props.children.at(-1).props.children as ReactElement<{ onClick: () => Promise<void> }>[];
  return actions.map((button) => button.props.onClick);
}
function key(fetch: ReturnType<typeof vi.fn>, index: number) {
  return new Headers(fetch.mock.calls[index][1].headers).get('Idempotency-Key');
}

describe('review action intent', () => {
  it.each([0, 1, 2])('renders locked inputs and only the original recovery action after uncertainty (%s)', async index => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('response lost')));
    await buttons()[index]();
    buttons();
    const html = renderToStaticMarkup(latestView);
    expect(html).toContain('An action is unresolved');
    const recovery = html.match(/<button[^>]*>Check original (?:approval|revision|rejection)<\/button>/g);
    expect(recovery).toHaveLength(1);
    expect(recovery![0]).not.toContain('disabled');
    for (const control of html.match(/<(?:input|textarea|select)\b[^>]*>/g) ?? []) {
      expect(control).toContain('disabled');
    }
    for (const button of html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []) {
      if (!button.includes('Check original')) expect(button).toContain('disabled');
    }
  });
  it('can recover an unchanged scheduled approval after its slot has passed', async () => {
    const slot = new Date(2030, 0, 15, 12, 0);
    vi.spyOn(Date, 'now').mockReturnValue(slot.getTime() - 60_000);
    hooks.values[2] = '2030-01-15T12:00';
    const fetch = vi.fn().mockRejectedValue(new Error('response lost'));
    vi.stubGlobal('fetch', fetch);
    await buttons()[0]();
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.mocked(Date.now).mockReturnValue(slot.getTime() + 60_000);
    fetch.mockImplementation(success);
    await buttons()[0]();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(key(fetch, 2)).toBe(key(fetch, 0));
    expect(fetch.mock.calls[2][1].body).toBe(fetch.mock.calls[0][1].body);
    expect(hooks.refresh).toHaveBeenCalledOnce();
  });

  it('reconciles the original approval when the reviewed revision changes after a lost response', async () => {
    const slot = new Date(2030, 0, 15, 12, 0);
    vi.spyOn(Date, 'now').mockReturnValue(slot.getTime() - 60_000);
    hooks.values[2] = '2030-01-15T12:00';
    const fetch = vi.fn().mockRejectedValue(new Error('response lost'));
    vi.stubGlobal('fetch', fetch);
    await buttons('revision-a')[0]();
    vi.mocked(Date.now).mockReturnValue(slot.getTime() + 60_000);
    fetch.mockImplementation(success);
    await buttons('revision-b')[0]();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(key(fetch, 2)).toBe(key(fetch, 0));
    expect(fetch.mock.calls[2][1].body).toBe(fetch.mock.calls[0][1].body);
  });

  it('does not retain the expired-slot exception after confirmed success', async () => {
    const slot = new Date(2030, 0, 15, 12, 0);
    vi.spyOn(Date, 'now').mockReturnValue(slot.getTime() - 60_000);
    hooks.values[2] = '2030-01-15T12:00';
    const fetch = vi.fn().mockImplementation(success);
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
    fetch.mockImplementation(success);
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
    finish(success('/approve'));
    await pending;
  });

  it('reconciles the unresolved original revision before permitting a new intent', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('response lost'));
    vi.stubGlobal('fetch', fetch);
    await buttons('revision-a')[2]();
    fetch.mockImplementation(success);
    await buttons('revision-b')[2]();
    expect(key(fetch, 2)).toBe(key(fetch, 0));
    expect(fetch.mock.calls[2][1].body).toBe(fetch.mock.calls[0][1].body);
  });
  it('refuses to switch actions after an unknown outcome', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('response lost'));
    vi.stubGlobal('fetch', fetch);
    await buttons()[0]();
    await buttons()[2]();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('retains revision instructions after an unknown outcome even if inputs change', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('response lost'));
    vi.stubGlobal('fetch', fetch);
    await buttons()[1]();
    hooks.values[3] = 'Different instructions';
    fetch.mockImplementation(success);
    await buttons()[1]();
    expect(key(fetch, 2)).toBe(key(fetch, 0));
    expect(fetch.mock.calls[2][1].body).toBe(fetch.mock.calls[0][1].body);
  });
  it.each([401, 403, 404, 409, 429, 500])('retains the original action after HTTP %s', async status => {
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ detail: 'Review action not confirmed' }), { status }));
    vi.stubGlobal('fetch', fetch);
    await buttons()[1]();
    expect(hooks.values[6]).toBe('Review action not confirmed');
    const next = fetch.mock.calls.length;
    hooks.values[3] = 'Changed after error';
    fetch.mockImplementation(success);
    await buttons()[1]();
    expect(key(fetch, next)).toBe(key(fetch, 0));
    expect(fetch.mock.calls[next][1].body).toBe(fetch.mock.calls[0][1].body);
  });
  it.each([400, 422])('permits corrected input after validation HTTP %s', async status => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status })).mockImplementation(success);
    vi.stubGlobal('fetch', fetch);
    await buttons()[1]();
    hooks.values[3] = 'Corrected instructions';
    await buttons()[1]();
    expect(key(fetch, 1)).not.toBe(key(fetch, 0));
    expect(JSON.parse(fetch.mock.calls[1][1].body).instructions).toBe('Corrected instructions');
  });
  it.each([0, 1, 2])('does not resolve action %s from a malformed or mismatched receipt', async index => {
    for (const body of [{}, { data: null }, { data: { id: bundleId, state: 'generated' } },
      { data: { id: revision, state: ['approved', 'revising', 'rejected'][index] } }]) {
      const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body)));
      vi.stubGlobal('fetch', fetch);
      await buttons()[index]();
      expect(hooks.refresh).not.toHaveBeenCalled();
      expect(hooks.values[6]).toContain('could not be confirmed');
      fetch.mockImplementation(success);
      await buttons()[index]();
      expect(key(fetch, 1)).toBe(key(fetch, 0));
      expect(hooks.refresh).toHaveBeenCalledOnce();
      hooks.refresh.mockClear();
    }
  });
  it('does not report a queued revision without its pending scan and revision identifier', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: bundleId, state: 'revising' } })));
    vi.stubGlobal('fetch', fetch);
    await buttons()[1]();
    expect(hooks.refresh).not.toHaveBeenCalled();
    expect(hooks.values[4]).toBeNull();
  });
});
