import { afterEach, expect, it, vi } from 'vitest';
import type { FormEvent } from 'react';
const state = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (value: unknown) => [value, vi.fn()], useRef: (current: unknown) => ({ current }),
}));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: () => 'schedule-intent', mutationFetch: state.send }));
import PostScheduleForm, { postScheduleIntent } from './PostScheduleForm';
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
function fields(action = 'reschedule', confirm = 'on', scheduledFor = '2090-03-20T15:30') {
  const data = new FormData();
  data.set('action', action); data.set('confirm', confirm); data.set('scheduledFor', scheduledFor);
  return data;
}
it('requires confirmation and a future valid local slot', () => {
  expect(() => postScheduleIntent(fields('reschedule', ''))).toThrow('Confirm');
  expect(() => postScheduleIntent(fields('reschedule', 'on', ''))).toThrow('future');
  expect(() => postScheduleIntent(fields('reschedule', 'on', '2000-01-01T12:00'))).toThrow('future');
  expect(postScheduleIntent(fields())).toEqual({ method: 'PATCH', body: JSON.stringify({ scheduledFor: new Date('2090-03-20T15:30').toISOString() }) });
  expect(postScheduleIntent(fields('cancel', 'on', ''))).toEqual({ method: 'DELETE', body: undefined });
});
it('retains the original reschedule request when a retry follows edited fields', async () => {
  const data = fields();
  vi.stubGlobal('FormData', class { get(key: string) { return data.get(key); } });
  state.send.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(new Response(JSON.stringify({ data: {
    id: 'post', state: 'pending', scheduledFor: new Date('2090-03-20T15:30').toISOString(),
  } })));
  const form = { reset: vi.fn() };
  const element = PostScheduleForm({ postId: 'post' });
  const submit = element.props.children[1].props.onSubmit;
  const event = { preventDefault() {}, currentTarget: form } as unknown as FormEvent<HTMLFormElement>;
  await submit(event);
  expect(state.refresh).not.toHaveBeenCalled();
  data.set('action', 'cancel');
  await submit(event);
  expect(state.send.mock.calls[0]).toEqual(state.send.mock.calls[1]);
  expect(state.send.mock.calls[1][1].method).toBe('PATCH');
  expect(state.send.mock.calls[1][2]).toEqual({ idempotencyKey: 'schedule-intent', retries: 0 });
  expect(state.refresh).toHaveBeenCalledOnce();
});
it('cancels through the existing endpoint and rejects empty successful responses', async () => {
  const data = fields('cancel');
  vi.stubGlobal('FormData', class { get(key: string) { return data.get(key); } });
  state.send.mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'post', state: 'canceled' } })));
  const form = { reset: vi.fn() };
  const submit = PostScheduleForm({ postId: 'post' }).props.children[1].props.onSubmit;
  const event = { preventDefault() {}, currentTarget: form } as unknown as FormEvent<HTMLFormElement>;
  await submit(event);
  expect(state.refresh).not.toHaveBeenCalled();
  await submit(event);
  expect(state.send).toHaveBeenCalledWith('/api/v1/posts/post', { method: 'DELETE' }, { idempotencyKey: 'schedule-intent', retries: 0 });
  expect(form.reset).toHaveBeenCalledOnce();
  expect(state.refresh).toHaveBeenCalledOnce();
});
