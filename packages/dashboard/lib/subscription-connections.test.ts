import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectSubscription, disconnectSubscription, readSubscriptionStatus } from './subscription-connections';

const signal = () => new AbortController().signal;

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

it('validates the provider and connected state returned by status', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ provider: 'openai', connected: true }));
  vi.stubGlobal('fetch', fetcher);
  await expect(readSubscriptionStatus('openai', signal())).resolves.toEqual({ provider: 'openai', connected: true });
  expect(fetcher).toHaveBeenCalledWith('/api/v1/llm/subscriptions/openai', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ provider: 'anthropic', connected: true })));
  await expect(readSubscriptionStatus('openai', signal())).rejects.toThrow('Invalid subscription status');
});

it('requires an explicit server-confirmed disconnected response', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ provider: 'anthropic', connected: false }));
  vi.stubGlobal('fetch', fetcher);
  await expect(disconnectSubscription('anthropic', signal())).resolves.toEqual({ provider: 'anthropic', connected: false });
  expect(fetcher).toHaveBeenCalledWith('/api/v1/llm/subscriptions/anthropic', expect.objectContaining({ method: 'DELETE', credentials: 'same-origin' }));
});

it('consumes bounded login SSE instructions and requires the connected event', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(
    'data: {"message":"Open the provider login page"}\n\n' +
    'event: connected\n' +
    'data: {}\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  ));
  vi.stubGlobal('fetch', fetcher);
  const messages: string[] = [];
  await expect(connectSubscription('openai', signal(), message => messages.push(message))).resolves.toBeUndefined();
  expect(messages).toEqual(['Open the provider login page']);
  expect(fetcher).toHaveBeenCalledWith('/api/v1/llm/subscriptions/openai/login', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
});

it('fails closed when login ends without confirmation or exceeds the output bound', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('data: {"message":"still waiting"}\n\n')));
  await expect(connectSubscription('anthropic', signal(), () => {})).rejects.toThrow('without confirmation');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
    `data: {"message":"${'x'.repeat(2100)}"}\n\n`,
  )));
  await expect(connectSubscription('anthropic', signal(), () => {})).rejects.toThrow('exceeded its limit');
});
