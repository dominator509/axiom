import { readDashboardJson } from './response';

export const SELF_SERVICE_SUBSCRIPTION_PROVIDERS = ['openai', 'anthropic'] as const;
export type SelfServiceSubscriptionProvider = (typeof SELF_SERVICE_SUBSCRIPTION_PROVIDERS)[number];
export type SubscriptionStatus = {
  provider: SelfServiceSubscriptionProvider;
  connected: boolean;
};

const endpoint = (provider: SelfServiceSubscriptionProvider) => `/api/v1/llm/subscriptions/${provider}`;
const MAX_LOGIN_BYTES = 64 * 1024;
const MAX_LOGIN_LINES = 128;
const MAX_LOGIN_LINE_BYTES = 2048;

function isProvider(value: unknown, expected: SelfServiceSubscriptionProvider): value is SelfServiceSubscriptionProvider {
  return value === expected;
}

function parseStatus(value: unknown, provider: SelfServiceSubscriptionProvider): SubscriptionStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid subscription status');
  const body = value as { provider?: unknown; connected?: unknown };
  if (!isProvider(body.provider, provider) || typeof body.connected !== 'boolean')
    throw new Error('Invalid subscription status');
  return { provider, connected: body.connected };
}

export async function readSubscriptionStatus(
  provider: SelfServiceSubscriptionProvider,
  signal: AbortSignal,
): Promise<SubscriptionStatus> {
  signal.throwIfAborted();
  const response = await fetch(endpoint(provider), {
    method: 'GET', signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error',
  });
  if (!response.ok) throw new Error('Unable to read subscription status');
  return parseStatus(await readDashboardJson<unknown>(response), provider);
}

export async function disconnectSubscription(
  provider: SelfServiceSubscriptionProvider,
  signal: AbortSignal,
): Promise<SubscriptionStatus> {
  signal.throwIfAborted();
  const response = await fetch(endpoint(provider), {
    method: 'DELETE', signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error',
  });
  if (!response.ok) throw new Error('Unable to disconnect subscription');
  return parseStatus(await readDashboardJson<unknown>(response), provider);
}

function parseEventBlock(block: string, onMessage: (message: string) => void): 'connected' | 'error' | null {
  let event = '';
  let data = '';
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trimStart();
  }
  if (data) {
    if (data.length > MAX_LOGIN_LINE_BYTES) throw new Error('Provider login output exceeded its limit');
    try {
      const value = JSON.parse(data) as { message?: unknown };
      if (typeof value.message === 'string' && value.message) onMessage(value.message.slice(0, MAX_LOGIN_LINE_BYTES));
    } catch {
      throw new Error('Invalid provider login response');
    }
  }
  if (event === 'error') return 'error';
  if (event === 'connected') return 'connected';
  return null;
}

/** Run one explicit provider login and consume only the bounded SSE instructions. */
export async function connectSubscription(
  provider: SelfServiceSubscriptionProvider,
  signal: AbortSignal,
  onMessage: (message: string) => void,
): Promise<void> {
  signal.throwIfAborted();
  const response = await fetch(`${endpoint(provider)}/login`, {
    method: 'POST', signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error',
    headers: { Accept: 'text/event-stream' },
  });
  if (!response.ok || !response.body) throw new Error('Unable to start provider login');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let bytes = 0;
  let lines = 0;
  let connected = false;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_LOGIN_BYTES) throw new Error('Provider login output exceeded its limit');
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary).replace(/\r$/, '');
        buffer = buffer.slice(boundary + 2);
        lines += block.split(/\r?\n/).length;
        if (lines > MAX_LOGIN_LINES) throw new Error('Provider login output exceeded its limit');
        const result = parseEventBlock(block, onMessage);
        if (result === 'error') throw new Error('Provider login did not complete');
        if (result === 'connected') connected = true;
        boundary = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const result = parseEventBlock(buffer, onMessage);
      if (result === 'error') throw new Error('Provider login did not complete');
      if (result === 'connected') connected = true;
    }
  } finally {
    reader.releaseLock();
  }
  if (!connected) throw new Error('Provider login ended without confirmation');
}
