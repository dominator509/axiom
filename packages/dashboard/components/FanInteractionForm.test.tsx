import { afterEach, expect, it, vi } from 'vitest';
import type { FormEvent } from 'react';
const state = vi.hoisted(() => ({ refresh: vi.fn(), send: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (value: unknown) => [value, vi.fn()],
  useRef: (current: unknown) => ({ current }),
}));
vi.mock('@/lib/mutation', () => ({
  createIdempotencyKey: () => 'same-entry',
  mutationFetch: state.send,
}));
vi.mock('./LocaleProvider', () => ({ useLocale: () => ({ t: (key: string) => key }) }));
import FanInteractionForm, { interactionPayload } from './FanInteractionForm';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function data(values: Record<string, string | undefined>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) form.set(key, value);
  return form;
}
it('matches the existing fan-scoped contract', () => {
  expect(
    interactionPayload(
      'fan',
      data({ platform: ' x ', kind: ' comment ', direction: 'inbound', content: ' Hello ' }),
    ),
  ).toEqual({
    fanId: 'fan',
    platform: 'x',
    kind: 'comment',
    direction: 'inbound',
    content: 'Hello',
  });
});
it('rejects invalid or oversized fields', () => {
  for (const values of [
    { platform: '', kind: 'note', direction: 'inbound' },
    { platform: 'x', kind: 'note', direction: 'send-now' },
    { platform: 'x', kind: 'note', direction: 'inbound', content: 'x'.repeat(4001) },
  ])
    expect(() => interactionPayload('fan', data(values))).toThrow();
});
it('reuses payload and key after uncertainty and refreshes only on success', async () => {
  const values = new Map([
    ['platform', 'x'],
    ['kind', 'comment'],
    ['direction', 'inbound'],
    ['content', 'Original'],
  ]);
  vi.stubGlobal(
    'FormData',
    class {
      get(key: string) {
        return values.get(key) ?? null;
      }
    },
  );
  state.send
    .mockRejectedValueOnce(new Error('lost response'))
    .mockResolvedValueOnce(new Response('{}', { status: 201 }));
  const form = { reset: vi.fn() };
  const event = {
    preventDefault() {},
    currentTarget: form,
  } as unknown as FormEvent<HTMLFormElement>;
  const element = FanInteractionForm({ fanId: 'fan', platform: 'x' });
  await element.props.onSubmit(event);
  expect(state.refresh).not.toHaveBeenCalled();
  values.set('content', 'Changed');
  await element.props.onSubmit(event);
  expect(state.send.mock.calls[0]).toEqual(state.send.mock.calls[1]);
  expect(state.send.mock.calls[0][0]).toBe('/api/v1/fans/fan/touchpoints');
  expect(JSON.parse(state.send.mock.calls[1][1].body).content).toBe('Original');
  expect(form.reset).toHaveBeenCalledOnce();
  expect(state.refresh).toHaveBeenCalledOnce();
});
