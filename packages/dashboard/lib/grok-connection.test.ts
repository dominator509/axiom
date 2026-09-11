import { afterEach, expect, it, vi } from 'vitest';
import { cancelGrok, connectGrok, grokConnectionStatus, resumeGrok } from './grok-connection';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const id = '11111111-1111-4111-8111-111111111111';
const signal = () => new AbortController().signal;
const state = (value = 'pending', messages: unknown[] = ['Visit provider']) => ({ id, state: value, messages });
it('starts once, polls the same attempt and verifies saved credentials', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(state()))
    .mockResolvedValueOnce(Response.json(state('completed', [])))
    .mockResolvedValueOnce(Response.json({ provider: 'grok', connected: true }));
  vi.stubGlobal('fetch', fetcher);
  const message = vi.fn();
  const running = connectGrok(signal(), message);
  await vi.advanceTimersByTimeAsync(1600);
  await running;
  expect(message).toHaveBeenCalledWith('Visit provider');
  expect(fetcher.mock.calls[0]).toEqual(['/api/v1/llm/subscriptions/grok/login-attempt', expect.objectContaining({ method: 'POST', credentials: 'same-origin', redirect: 'error' })]);
  expect(fetcher.mock.calls[1][0]).toContain(id);
  expect(fetcher.mock.calls.filter(c => c[1].method === 'POST')).toHaveLength(1);
});
it('resumes after reload using GET only', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ attempt: state('completed', []) }))
    .mockResolvedValueOnce(Response.json({ provider: 'grok', connected: true }));
  vi.stubGlobal('fetch', fetcher);
  expect(await resumeGrok(signal(), () => {}, () => {})).toBe(true);
  expect(fetcher.mock.calls.every(c => c[1].method === 'GET')).toBe(true);
});
it('cancelling observation never sends a remote cancel or another POST', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockResolvedValue(Response.json(state()));
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  const running = connectGrok(controller.signal, () => {});
  const rejected = expect(running).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  await rejected;
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('only explicit cancellation deletes the exact attempt', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(state('cancelling', [])));
  vi.stubGlobal('fetch', fetcher);
  expect((await cancelGrok(id, signal())).state).toBe('cancelling');
  expect(fetcher.mock.calls[0]).toEqual(['/api/v1/llm/subscriptions/grok/login-attempt/' + id, expect.objectContaining({ method: 'DELETE' })]);
});
it.each(['failed', 'cancelled', 'timed_out'])('does not report %s as successful login', async terminal => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(state(terminal, []))));
  await expect(connectGrok(signal(), () => {})).rejects.toThrow();
});
it('does not accept CLI completion without a saved credential', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json(state('completed', [])))
    .mockResolvedValueOnce(Response.json({ provider: 'grok', connected: false })));
  await expect(connectGrok(signal(), () => {})).rejects.toThrow('could not be confirmed');
});
it.each([null, {}, state('unknown'), state('pending', [123]), state('pending', ['x'.repeat(16385)])])('rejects malformed attempt data', async body => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)));
  await expect(connectGrok(signal(), () => {})).rejects.toThrow();
});
it('never retries transport failure', async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error('offline')); vi.stubGlobal('fetch', fetcher);
  await expect(connectGrok(signal(), () => {})).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects authentication errors and invalid status', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('denied', { status: 401 }))
    .mockResolvedValueOnce(Response.json({ provider: 'other', connected: true })));
  await expect(connectGrok(signal(), () => {})).rejects.toThrow();
  await expect(grokConnectionStatus(signal())).rejects.toThrow();
});
it('does not start an already aborted request', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController(); controller.abort();
  await expect(connectGrok(controller.signal, () => {})).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher).not.toHaveBeenCalled();
});
