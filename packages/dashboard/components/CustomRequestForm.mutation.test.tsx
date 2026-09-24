import { afterEach, expect, it, vi } from 'vitest';
import type { FormEvent } from 'react';
const state = vi.hoisted(() => ({ refresh: vi.fn(), send: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (value: unknown) => [value, vi.fn()], useRef: (current: unknown) => ({ current }),
}));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: () => 'same-intent', mutationFetch: state.send }));
vi.mock('./LocaleProvider', () => ({ useLocale: () => ({ t: (key: string) => key }) }));
import CustomRequestForm from './CustomRequestForm';
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('reuses the original creation payload and key after an uncertain response', async () => {
  const fields = new Map([['title', 'Portrait'], ['priceUsd', '25']]);
  vi.stubGlobal('FormData', class { get(key: string) { return fields.get(key) ?? null; } });
  state.send.mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce(new Response('{}', { status: 201 }));
  const form = { reset: vi.fn() };
  const event = { preventDefault() {}, currentTarget: form } as unknown as FormEvent<HTMLFormElement>;
  const element = CustomRequestForm({ modelId: 'model', fans: [] });
  await element.props.onSubmit(event);
  expect(state.refresh).not.toHaveBeenCalled();
  fields.set('title', 'Changed after timeout');
  await element.props.onSubmit(event);
  expect(state.send.mock.calls[0]).toEqual(state.send.mock.calls[1]);
  expect(JSON.parse(state.send.mock.calls[1][1].body)).toEqual({ modelId: 'model', title: 'Portrait', priceUsd: 25 });
  expect(state.refresh).toHaveBeenCalledOnce();
  expect(form.reset).toHaveBeenCalledOnce();
});
it('patches the existing ticket status without resetting the selected value', async () => {
  vi.stubGlobal('FormData', class { get() { return 'delivered'; } });
  state.send.mockResolvedValueOnce(new Response('{}'));
  const form = { reset: vi.fn() };
  const element = CustomRequestForm({ requestId: 'ticket', title: 'Portrait', status: 'editing' });
  await element.props.onSubmit({ preventDefault() {}, currentTarget: form } as unknown as FormEvent<HTMLFormElement>);
  expect(state.send).toHaveBeenCalledWith('/api/v1/custom-requests/ticket', expect.objectContaining({ method: 'PATCH', body: '{"status":"delivered"}' }), { idempotencyKey: 'same-intent' });
  expect(form.reset).not.toHaveBeenCalled();
});
