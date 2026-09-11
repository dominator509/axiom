import { readDashboardJson } from './response';

const endpoint = '/api/v1/llm/subscriptions/grok';
export async function grokConnectionStatus(signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  const response = await fetch(endpoint, { signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
  if (!response.ok) throw new Error('Unable to check Grok connection');
  const result = await readDashboardJson<{ provider: string; connected: boolean }>(response);
  if (result.provider !== 'grok' || typeof result.connected !== 'boolean') throw new Error('Invalid connection status');
  return result.connected;
}

// Consume only the existing login event contract. No retries: a new login is
// an explicit user action. Never interpret provider messages as HTML or URLs.
export async function connectGrok(signal: AbortSignal, onMessage: (message: string) => void): Promise<void> {
  signal.throwIfAborted();
  const response = await fetch(`${endpoint}/login`, { method: 'POST', signal,
    credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'text/event-stream' || !response.body)
    throw new Error('Unable to start Grok login');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', bytes = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) throw new Error('Grok login ended without confirmation');
      bytes += value.byteLength;
      if (bytes > 65536) throw new Error('Grok login output exceeded its limit');
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const lines = event.split('\n');
        const type = lines.find(line => line.startsWith('event:'))?.slice(6).trim() ?? 'message';
        const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (type === 'error') throw new Error('Grok login did not complete');
        if (type === 'connected') {
          if (!await grokConnectionStatus(signal)) throw new Error('Grok connection could not be confirmed');
          return;
        }
        if (type !== 'message' || !data) continue;
        const parsed = JSON.parse(data) as { message?: unknown };
        if (typeof parsed.message !== 'string' || parsed.message.length > 8192) throw new Error('Invalid login message');
        onMessage(parsed.message);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
