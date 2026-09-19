import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], refs: [] as { current: unknown }[], i: 0, r: 0,
  fetch: vi.fn(), key: vi.fn(), refresh: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = hooks.i++;
    if (!(i in hooks.values)) hooks.values[i] = initial;
    return [hooks.values[i], (value: unknown) => { hooks.values[i] = value; }];
  },
  useRef: (initial: unknown) => hooks.refs[hooks.r++] ??= { current: initial },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: hooks.key, mutationFetch: hooks.fetch }));
import CharacterLockEditor from './CharacterLockEditor';
function render() {
  hooks.i = 0; hooks.r = 0;
  return CharacterLockEditor({ modelId: 'model', initialPrompt: 'Original identity', initialVersion: 4 }).props.children;
}
beforeEach(() => { hooks.values = []; hooks.refs = []; hooks.fetch.mockReset(); hooks.refresh.mockReset();
  hooks.key.mockReset().mockReturnValue('save-intent'); });
it('saves an edited prompt with the viewed revision without dispatching on render', async () => {
  render(); expect(hooks.fetch).not.toHaveBeenCalled();
  hooks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: { id: 'model', characterLockPrompt: 'Updated identity', characterLockVersion: 5 } })));
  render()[1].props.onChange({ target: { value: 'Updated identity' } }); render()[3].props.onClick();
  await vi.waitFor(() => expect(hooks.values[2]).toBe(false));
  expect(JSON.parse(hooks.fetch.mock.calls[0][1].body)).toEqual({ characterLockPrompt: 'Updated identity', characterLockVersion: 4 });
  expect(hooks.values[1]).toBe(5);
  expect(render()[1].props.disabled).toBe(false);
});
it('locks edits and reuses the exact intent after a lost response', async () => {
  hooks.fetch.mockRejectedValue(new Error('lost response'));
  render()[3].props.onClick(); render()[3].props.onClick();
  expect(hooks.fetch).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(hooks.values[2]).toBe(false));
  expect(render()[1].props.disabled).toBe(true);
  render()[3].props.onClick();
  await vi.waitFor(() => expect(hooks.fetch).toHaveBeenCalledTimes(2));
  expect(hooks.fetch.mock.calls[1]).toEqual(hooks.fetch.mock.calls[0]);
  expect(hooks.key).toHaveBeenCalledOnce();
});
it('requires a reload on revision conflict rather than overwriting', async () => {
  hooks.fetch.mockResolvedValue(new Response(JSON.stringify({ code: 'CHARACTER_LOCK_CONFLICT', detail: 'Reload' }), { status: 409 }));
  render()[3].props.onClick(); await vi.waitFor(() => expect(hooks.values[2]).toBe(false));
  expect(render()[3].props.disabled).toBe(true);
  render()[3].props.onClick(); expect(hooks.fetch).toHaveBeenCalledOnce();
  render()[4].props.onClick(); expect(hooks.refresh).toHaveBeenCalledOnce();
});
it('does not accept a response for a different profile', async () => {
  hooks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: { id: 'other', characterLockPrompt: 'Original identity', characterLockVersion: 5 } })));
  render()[3].props.onClick(); await vi.waitFor(() => expect(hooks.values[2]).toBe(false));
  expect(hooks.values[1]).toBe(4);
  expect(render()[1].props.disabled).toBe(true);
});
