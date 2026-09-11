import { readDashboardJson } from './response';
const endpoint = '/api/v1/llm/subscriptions/grok';
export type GrokAttempt = { id: string; state: 'pending' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'timed_out'; messages: string[] };
function attempt(value: unknown): GrokAttempt {
  const a = value as GrokAttempt | null;
  if (!a || typeof a.id !== 'string' || !/^[a-f0-9-]{36}$/.test(a.id)
    || !['pending', 'cancelling', 'completed', 'failed', 'cancelled', 'timed_out'].includes(a.state)
    || !Array.isArray(a.messages) || a.messages.length > 128
    || a.messages.some(m => typeof m !== 'string')
    || new TextEncoder().encode(a.messages.join('')).byteLength > 16384)
    throw new Error('Invalid Grok login attempt');
  return a;
}
async function request(path: string, signal: AbortSignal, method = 'GET'): Promise<unknown> {
  signal.throwIfAborted();
  const response = await fetch(path, { method, signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
  if (!response.ok) throw new Error('Unable to read Grok connection');
  return readDashboardJson<unknown>(response);
}
export async function grokConnectionStatus(signal: AbortSignal): Promise<boolean> {
  const result = await request(endpoint, signal) as { provider?: unknown; connected?: unknown };
  if (result?.provider !== 'grok' || typeof result.connected !== 'boolean') throw new Error('Invalid connection status');
  return result.connected;
}
function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const stop = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, 1500);
    signal.addEventListener('abort', stop, { once: true });
  });
}
async function observe(initial: GrokAttempt, signal: AbortSignal, onMessage: (message: string) => void,
  onAttempt: (value: GrokAttempt) => void): Promise<boolean> {
  let current = initial;
  for (;;) {
    signal.throwIfAborted();
    onAttempt(current);
    onMessage(current.messages.join('\n'));
    if (current.state === 'completed') {
      if (!await grokConnectionStatus(signal)) throw new Error('Grok connection could not be confirmed');
      return true;
    }
    if (current.state !== 'pending' && current.state !== 'cancelling')
      throw new Error('Grok login ' + current.state.replace('_', ' '));
    await pause(signal);
    current = attempt(await request(endpoint + '/login-attempt/' + initial.id, signal));
    if (current.id !== initial.id) throw new Error('Grok login attempt changed');
  }
}
// One POST per explicit click; transport errors never mint another code.
export async function connectGrok(signal: AbortSignal, onMessage: (message: string) => void,
  onAttempt: (value: GrokAttempt) => void = () => {}): Promise<void> {
  await observe(attempt(await request(endpoint + '/login-attempt', signal, 'POST')), signal, onMessage, onAttempt);
}
// Reload/focus recovery is read-only and resumes the server-owned attempt.
export async function resumeGrok(signal: AbortSignal, onMessage: (message: string) => void,
  onAttempt: (value: GrokAttempt) => void): Promise<boolean> {
  const latest = await request(endpoint + '/login-attempt', signal) as { attempt?: unknown };
  if (!latest || !Object.prototype.hasOwnProperty.call(latest, 'attempt')) throw new Error('Invalid Grok login status');
  if (latest.attempt === null) return grokConnectionStatus(signal);
  const current = attempt(latest.attempt);
  if (['failed', 'cancelled', 'timed_out'].includes(current.state)) {
    onAttempt(current); onMessage('');
    return grokConnectionStatus(signal);
  }
  return observe(current, signal, onMessage, onAttempt);
}
export async function cancelGrok(id: string, signal: AbortSignal): Promise<GrokAttempt> {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid Grok login attempt');
  const result = attempt(await request(endpoint + '/login-attempt/' + id, signal, 'DELETE'));
  if (result.id !== id) throw new Error('Grok login attempt changed');
  return result;
}
