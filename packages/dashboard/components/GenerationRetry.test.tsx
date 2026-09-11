import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], refs: [] as { current: unknown }[], i: 0, r: 0, fetch: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = hooks.i++;
    if (!(i in hooks.values)) hooks.values[i] = initial;
    return [hooks.values[i], (value: unknown) => { hooks.values[i] = value; }];
  },
  useRef: (initial: unknown) => hooks.refs[hooks.r++] ??= { current: initial },
}));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: () => 'intent-key', mutationFetch: hooks.fetch }));
import GenerationRetry from './GenerationRetry';
const queued = vi.fn();
function render(blocked = false) {
  hooks.i = 0; hooks.r = 0;
  return GenerationRetry({ modelId: 'model', bundleId: 'bundle', blocked, onQueued: queued }).props.children;
}
beforeEach(() => { hooks.values = []; hooks.refs = []; hooks.fetch.mockReset(); queued.mockReset(); });
it('requires explicit charge acknowledgement and never dispatches on render', () => {
  expect(render()[4].props.disabled).toBe(true);
  render()[4].props.onClick();
  expect(hooks.fetch).not.toHaveBeenCalled();
});
it('blocks an unchanged moderation retry even if the event is invoked directly', () => {
  render(true)[3].props.children[0].props.onChange({ target: { checked: true } });
  render(true)[4].props.onClick();
  expect(hooks.fetch).not.toHaveBeenCalled();
});
it('retains the same intent after an uncertain response and suppresses parallel clicks', async () => {
  hooks.fetch.mockRejectedValue(new Error('lost response'));
  render()[3].props.children[0].props.onChange({ target: { checked: true } });
  render()[4].props.onClick(); render()[4].props.onClick();
  expect(hooks.fetch).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(hooks.values[3]).toBe(false));
  render()[4].props.onClick();
  await vi.waitFor(() => expect(hooks.fetch).toHaveBeenCalledTimes(2));
  expect(hooks.fetch.mock.calls[1]).toEqual(hooks.fetch.mock.calls[0]);
});
it('submits only operator-reviewed edits and follows the returned bundle', async () => {
  hooks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: { bundle: { id: '11111111-1111-4111-8111-111111111111' } } })));
  render(true)[1].props.onClick();
  render(true)[2].props.children[3].props.onChange({ target: { value: 'A ceramic vase' } });
  render(true)[3].props.children[0].props.onChange({ target: { checked: true } });
  render(true)[4].props.onClick();
  await vi.waitFor(() => expect(queued).toHaveBeenCalledOnce());
  expect(JSON.parse(hooks.fetch.mock.calls[0][1].body)).toEqual({ acknowledgeUsage: true, prompt: 'A ceramic vase' });
});
