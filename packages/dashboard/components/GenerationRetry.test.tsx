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
vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    t: (key: string) => ({
      'review.retryNotAccepted': 'Retry not accepted. Check Incidents before submitting again.',
      'review.retryUnconfirmed': 'Retry outcome unconfirmed. Retry again to check the same request; do not start another generation.',
      'review.generationRetry': 'Generation retry',
      'review.generationRetryDescription': 'A retry creates a new bundle and rejects the previous bundle, retaining its evidence. Provider usage may be charged. All moderation and ToS checks run again.',
      'review.reviewSuggestedModifications': 'Review suggested modifications',
      'review.retryPromptDescription': 'Edit the prompt yourself or ask the generating provider for a minimal revision of the last tried prompt below.',
      'review.retryPromptLimitations': 'Prompt edits cannot fix ZDR, storage, sign-in, or quota errors. A video source-image problem may require a new generation with a different source image.',
      'review.reviewRevisedPrompt': 'Review and write the revised prompt',
      'review.approveNewGeneration': 'I approve a new generation and possible provider charges.',
      'review.checkingRetry': 'Checking retry…',
      'review.checkSameRequest': 'Check / retry same request',
      'review.retryWithReviewedModifications': 'Retry with reviewed modifications',
      'review.retryGeneration': 'Retry generation',
      'review.blockedPromptRequired': 'Blocked content requires a revised prompt before retrying.',
    }[key] ?? key),
  }),
}));
import GenerationRetry from './GenerationRetry';
const queued = vi.fn();
function successResponse() {
  return new Response(JSON.stringify({ data: { bundle: {
    id: '11111111-1111-4111-8111-111111111111', modelId: 'model',
  }, mediaGeneration: 'queued' } }));
}
function render(blocked = false) {
  hooks.i = 0; hooks.r = 0;
  return GenerationRetry({ modelId: 'model', bundleId: 'bundle', blocked, onQueued: queued }).props.children;
}
beforeEach(() => { hooks.values = []; hooks.refs = []; hooks.fetch.mockReset(); queued.mockReset();
  hooks.key.mockReset().mockImplementation(() => `intent-${hooks.key.mock.calls.length}`);
});
it('requires explicit charge acknowledgement and never dispatches on render', () => {
  expect(render()[4].props.disabled).toBe(true);
  render()[4].props.onClick();
  expect(hooks.fetch).not.toHaveBeenCalled();
});
it('unlocks a stalled response and reconciles using the original intent', async () => {
  vi.useFakeTimers();
  try {
    hooks.fetch.mockResolvedValueOnce(new Response(new ReadableStream()))
      .mockResolvedValueOnce(successResponse());
    render()[3].props.children[0].props.onChange({ target: { checked: true } });
    render()[4].props.onClick();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(hooks.values[3]).toBe(false);
    expect(hooks.values[4]).toContain('outcome unconfirmed');
    render()[4].props.onClick();
    await vi.advanceTimersByTimeAsync(0);
    expect(queued).toHaveBeenCalledOnce();
    expect(hooks.fetch.mock.calls[1]).toEqual(hooks.fetch.mock.calls[0]);
    expect(hooks.key).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
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
  hooks.fetch.mockResolvedValue(successResponse());
  render(true)[1].props.onClick();
  render(true)[2].props.children[3].props.onChange({ target: { value: 'A ceramic vase' } });
  render(true)[3].props.children[0].props.onChange({ target: { checked: true } });
  render(true)[4].props.onClick();
  await vi.waitFor(() => expect(queued).toHaveBeenCalledOnce());
  expect(JSON.parse(hooks.fetch.mock.calls[0][1].body)).toEqual({ acknowledgeUsage: true, prompt: 'A ceramic vase' });
});
it('retains the intent on an in-progress 409 and displays RFC7807 detail', async () => {
  hooks.fetch.mockImplementation(async () => new Response(JSON.stringify({
    title: 'Conflict', detail: 'A request with this key is still in progress',
  }), { status: 409, headers: { 'Retry-After': '2' } }));
  render()[3].props.children[0].props.onChange({ target: { checked: true } });
  render()[4].props.onClick();
  await vi.waitFor(() => expect(hooks.values[3]).toBe(false));
  expect(hooks.values[4]).toBe('A request with this key is still in progress');
  render()[4].props.onClick();
  await vi.waitFor(() => expect(hooks.fetch).toHaveBeenCalledTimes(2));
  expect(hooks.key).toHaveBeenCalledOnce();
  expect(hooks.fetch.mock.calls[1]).toEqual(hooks.fetch.mock.calls[0]);
});
it('unlocks edits only after a confirmed no-dispatch eligibility rejection', async () => {
  hooks.fetch.mockResolvedValue(new Response(JSON.stringify({
    detail: 'A changed prompt is required', code: 'MEDIA_RETRY_NOT_QUEUED',
  }), { status: 409 }));
  render()[3].props.children[0].props.onChange({ target: { checked: true } });
  render()[4].props.onClick();
  await vi.waitFor(() => expect(hooks.values[3]).toBe(false));
  expect(render()[1].props.disabled).toBe(false);
});
it('copies a Grok proposal into the editor but requires fresh generation consent', () => {
  render(true)[1].props.onClick();
  render(true)[3].props.children[0].props.onChange({ target: { checked: true } });
  render(true)[2].props.children[4].props.onUse('A reviewed Grok revision');
  expect(hooks.values[1]).toBe('A reviewed Grok revision');
  expect(hooks.values[2]).toBe(false);
  expect(hooks.fetch).not.toHaveBeenCalled();
  expect(render(true)[4].props.disabled).toBe(true);
});

it.each([401, 403, 404])('preserves reconciliation after HTTP %s without unlocking edits', async status => {
  hooks.fetch.mockResolvedValue(new Response('{}', { status }));
  render()[3].props.children[0].props.onChange({ target: { checked: true } });
  render()[4].props.onClick();
  await vi.waitFor(() => expect(hooks.values[3]).toBe(false));
  expect(render()[1].props.disabled).toBe(true);
  hooks.fetch.mockResolvedValue(successResponse());
  render()[4].props.onClick();
  await vi.waitFor(() => expect(queued).toHaveBeenCalledOnce());
  expect(hooks.key).toHaveBeenCalledOnce();
  expect(hooks.fetch.mock.calls[1]).toEqual(hooks.fetch.mock.calls[0]);
});

it.each([
  { bundle: { id: '-'.repeat(36), modelId: 'model' }, mediaGeneration: 'queued' },
  { bundle: { id: '11111111-1111-4111-8111-111111111111', modelId: 'other' }, mediaGeneration: 'queued' },
  { bundle: { id: '11111111-1111-4111-8111-111111111111', modelId: 'model' } },
])('does not follow an invalid retry receipt: %j', async data => {
  hooks.fetch.mockResolvedValue(new Response(JSON.stringify({ data })));
  render()[3].props.children[0].props.onChange({ target: { checked: true } });
  render()[4].props.onClick();
  await vi.waitFor(() => expect(hooks.values[3]).toBe(false));
  expect(queued).not.toHaveBeenCalled();
  expect(hooks.values[4]).toContain('unconfirmed');
  hooks.fetch.mockResolvedValue(successResponse());
  render()[4].props.onClick();
  await vi.waitFor(() => expect(queued).toHaveBeenCalledOnce());
  expect(hooks.fetch.mock.calls[1]).toEqual(hooks.fetch.mock.calls[0]);
});
