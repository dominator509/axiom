import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], refs: [] as { current: unknown }[], i: 0, r: 0, fetch: vi.fn(), key: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = hooks.i++;
    if (!(i in hooks.values)) hooks.values[i] = initial;
    return [hooks.values[i], (value: unknown) => { hooks.values[i] = value; }];
  },
  useRef: (initial: unknown) => hooks.refs[hooks.r++] ??= { current: initial },
}));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: hooks.key, mutationFetch: hooks.fetch }));
import MediaPromptSuggestion from './MediaPromptSuggestion';
const useProposal = vi.fn();
function render(disabled = false) {
  hooks.i = 0; hooks.r = 0;
  return MediaPromptSuggestion({ modelId: 'model', bundleId: 'bundle', disabled, onUse: useProposal }).props.children;
}
function approve() { render()[1].props.children[0].props.onChange({ target: { checked: true } }); }
const data = { provider: 'grok', requiresReview: true, mediaQueued: false,
  characterLockPrompt: 'Copper hair, green jacket', characterLockVersion: 3,
  lastTriedPrompt: 'The last attempted scene', prompt: 'The revised scene', explanation: 'One changed detail.' };
beforeEach(() => {
  hooks.values = []; hooks.refs = []; hooks.fetch.mockReset(); hooks.key.mockReset().mockReturnValue('one-intent'); useProposal.mockReset();
});
it('does not send requests on render or without separate text usage consent', () => {
  render()[2].props.onClick();
  expect(hooks.fetch).not.toHaveBeenCalled();
});
it('does not dispatch when the parent retry is locked', () => {
  approve(); render(true)[2].props.onClick();
  expect(hooks.fetch).not.toHaveBeenCalled();
});
it('retains one key after uncertainty and suppresses concurrent requests', async () => {
  hooks.fetch.mockRejectedValue(new Error('lost response'));
  approve(); render()[2].props.onClick(); render()[2].props.onClick();
  expect(hooks.fetch).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(hooks.values[1]).toBe(false));
  render()[2].props.onClick();
  await vi.waitFor(() => expect(hooks.fetch).toHaveBeenCalledTimes(2));
  expect(hooks.fetch.mock.calls[1]).toEqual(hooks.fetch.mock.calls[0]);
  expect(hooks.key).toHaveBeenCalledOnce();
  expect(hooks.fetch.mock.calls[0][2]).toMatchObject({ retries: 0, timeoutMs: 130_000 });
});
it('requires reviewing and explicitly selecting the returned proposal', async () => {
  hooks.fetch.mockResolvedValue(new Response(JSON.stringify({ data })));
  approve(); render()[2].props.onClick();
  await vi.waitFor(() => expect(hooks.values[3]).toEqual(data));
  expect(useProposal).not.toHaveBeenCalled();
  expect(hooks.fetch.mock.calls[0][0]).toContain('/suggest-prompt');
  expect(JSON.parse(hooks.fetch.mock.calls[0][1].body)).toEqual({ acknowledgeUsage: true });
  render()[4].props.children[6].props.onClick();
  expect(useProposal).toHaveBeenCalledWith(data.prompt);
  render()[2].props.onClick();
  expect(hooks.fetch).toHaveBeenCalledOnce();
});
it.each([{ ...data, provider: '' }, { ...data, mediaQueued: true }, { ...data, prompt: '' },
  { ...data, characterLockPrompt: undefined }, { ...data, characterLockPrompt: 'x'.repeat(2001) },
  { ...data, characterLockVersion: undefined }, { ...data, characterLockVersion: -1 },
  { ...data, characterLockVersion: 0.5 }, { ...data, characterLockVersion: 2147483648 },
  { ...data, prompt: data.lastTriedPrompt }, { ...data, explanation: 'x'.repeat(1001) }])('rejects invalid result contracts', async result => {
  hooks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: result })));
  approve(); render()[2].props.onClick();
  await vi.waitFor(() => expect(hooks.values[1]).toBe(false));
  expect(hooks.values[3]).toBeNull();
  expect(useProposal).not.toHaveBeenCalled();
});
it.each([
  { characterLockPrompt: data.characterLockPrompt, characterLockVersion: 3 },
  { characterLockPrompt: '', characterLockVersion: 0 },
])('shows the exact saved identity snapshot for review', async snapshot => {
  hooks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: { ...data, ...snapshot } })));
  approve(); render()[2].props.onClick();
  await vi.waitFor(() => expect(hooks.values[1]).toBe(false));
  const section = render()[4].props.children.find((child: { props?: { 'aria-label'?: string } }) => child?.props?.['aria-label'] === 'Saved character lock');
  expect(section.props.children[0].props.children).toContain(snapshot.characterLockVersion);
  expect(section.props.children[1].props.children).toBe(snapshot.characterLockPrompt || 'No character lock was saved with this attempt.');
  expect(useProposal).not.toHaveBeenCalled();
});
it('keeps the same request on an in-flight conflict', async () => {
  hooks.fetch.mockImplementation(async () => new Response(JSON.stringify({ detail: 'Still pending' }), { status: 409 }));
  approve(); render()[2].props.onClick();
  await vi.waitFor(() => expect(hooks.values[1]).toBe(false));
  expect(hooks.values[2]).toBe('Still pending');
  render()[2].props.onClick();
  await vi.waitFor(() => expect(hooks.fetch).toHaveBeenCalledTimes(2));
  expect(hooks.key).toHaveBeenCalledOnce();
});
