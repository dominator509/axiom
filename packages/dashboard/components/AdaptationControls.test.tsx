import { beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  stateIndex: 0,
  refIndex: 0,
  fetch: vi.fn(),
  key: vi.fn(),
}));

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
  useRef: (initial: unknown) => hooks.refs[hooks.refIndex++] ??= { current: initial },
}));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: hooks.key, mutationFetch: hooks.fetch }));
vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    locale: 'en',
    setLocale: vi.fn(),
    t: (key: string) => ({
      'review.adaptationSummary': 'Adapt for another platform or tone',
      'review.targetPlatform': 'Target platform',
      'review.adaptationInstructions': 'Adaptation instructions',
      'review.adaptationDefault': 'Adapt this caption for the selected platform: preserve the approved subject and intent, then apply that platform’s length, tone, and hashtag conventions.',
      'review.queueAdaptation': 'Queue adaptation',
      'review.queueingAdaptation': 'Queueing…',
      'review.retrySameAdaptation': 'Retry same adaptation',
      'review.adaptationQueued': 'Adaptation queued. A fresh ToS scan and approval are required.',
      'review.adaptationNotQueued': 'Adaptation was not queued.',
      'review.adaptationUnconfirmed': 'Adaptation queueing was not confirmed. Retry the same request.',
    }[key] ?? key),
  }),
}));

import AdaptationControls from './AdaptationControls';

function elements(node: unknown): any[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  if (typeof node !== 'object' || !('props' in node)) return [];
  const element = node as { props: { children?: unknown } };
  return [node, ...elements(element.props.children)];
}

function render() {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  return AdaptationControls({ bundleId: 'bundle-1', revisionId: 'revision-1', platforms: ['instagram'] });
}

function queueButton() {
  return elements(render()).find((element) => element?.type === 'button' && element.props.children === 'Queue adaptation');
}

beforeEach(() => {
  hooks.values = [];
  hooks.refs = [];
  hooks.fetch.mockReset();
  hooks.key.mockReset().mockReturnValue('adaptation-intent-1');
});

it('submits the selected platform as data and reports a confirmed queue', async () => {
  hooks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: { id: 'revision-1' } })));
  await queueButton().props.onClick();
  expect(JSON.parse(hooks.fetch.mock.calls[0][1].body)).toEqual({
    instructions: '[instagram] Adapt this caption for the selected platform: preserve the approved subject and intent, then apply that platform’s length, tone, and hashtag conventions.',
    revisionId: 'revision-1',
  });
  await vi.waitFor(() => expect(hooks.values[3]).toContain('Adaptation queued'));
});

it('retains the same request after an uncertain response and exposes the retry action', async () => {
  hooks.fetch.mockRejectedValue(new Error('lost response'));
  await queueButton().props.onClick();
  expect(hooks.values[4]).toContain('Adaptation queueing was not confirmed');
  const retry = elements(render()).find((element) => element?.type === 'button' && element.props.children === 'Retry same adaptation');
  await retry.props.onClick();
  expect(hooks.fetch).toHaveBeenCalledTimes(2);
  expect(hooks.fetch.mock.calls[1]).toEqual(hooks.fetch.mock.calls[0]);
  expect(hooks.key).toHaveBeenCalledOnce();
});

it('clears a confirmed validation rejection and reports the localized fallback', async () => {
  hooks.fetch.mockResolvedValue(new Response('{}', { status: 422 }));
  await queueButton().props.onClick();
  await vi.waitFor(() => expect(hooks.values[4]).toBe('Adaptation was not queued.'));
  expect(elements(render()).some((element) => element?.props?.children === 'Retry same adaptation')).toBe(false);
});
