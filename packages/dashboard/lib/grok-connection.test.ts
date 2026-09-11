import { afterEach, expect, it, vi } from 'vitest';
import { connectGrok, grokConnectionStatus } from './grok-connection';

afterEach(() => vi.unstubAllGlobals());
const signal = () => new AbortController().signal;
function events(chunks: string[]) {
  return new Response(new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
it('uses same-origin authenticated login once and verifies status after the terminal event', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(events(['data: {"message":"Visit Grok"}\n', '\nevent: connected\ndata: {}\n\n']))
    .mockResolvedValueOnce(Response.json({ provider: 'grok', connected: true }));
  vi.stubGlobal('fetch', fetcher);
  const message = vi.fn();
  await connectGrok(signal(), message);
  expect(message).toHaveBeenCalledWith('Visit Grok');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0]).toEqual(['/api/v1/llm/subscriptions/grok/login', expect.objectContaining({ method: 'POST', credentials: 'same-origin', redirect: 'error' })]);
  expect(fetcher.mock.calls[1][0]).toBe('/api/v1/llm/subscriptions/grok');
});
it.each(['data: {"message":"instructions"}\n\n', 'event: error\ndata: failure\n\n'])('never treats incomplete or error streams as connected', async body => {
  const fetcher = vi.fn().mockResolvedValue(events([body])); vi.stubGlobal('fetch', fetcher);
  await expect(connectGrok(signal(), () => {})).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects a terminal event when status is disconnected', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(events(['event: connected\ndata: {}\n\n']))
    .mockResolvedValueOnce(Response.json({ provider: 'grok', connected: false })));
  await expect(connectGrok(signal(), () => {})).rejects.toThrow('could not be confirmed');
});
it.each(['x'.repeat(65537), 'data: {"message":123}\n\n', 'data: invalid\n\n'])('rejects oversized or malformed provider output', async body => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(events([body])));
  await expect(connectGrok(signal(), () => {})).rejects.toThrow();
});
it('rejects authentication errors and unexpected status shapes', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('denied', { status: 401 }))
    .mockResolvedValueOnce(Response.json({ provider: 'other', connected: true })));
  await expect(connectGrok(signal(), () => {})).rejects.toThrow();
  await expect(grokConnectionStatus(signal())).rejects.toThrow();
});
it('does not accept an already cancelled login', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(events(['event: connected\ndata: {}\n\n'])));
  const controller = new AbortController(); controller.abort();
  await expect(connectGrok(controller.signal, () => {})).rejects.toMatchObject({ name: 'AbortError' });
});
