import { randomUUID } from 'node:crypto';
import type { LLMGateway } from './gateway.js';
import { ProviderError } from './providers/types.js';

type State = 'pending' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'timed_out';
type Attempt = {
  id: string; state: State; messages: string[]; bytes: number;
  controller: AbortController; expiresAt: number; settled: boolean;
};

// Process-local, bounded login ownership. Browser requests only observe it.
// A service restart loses pending attempts; it never fabricates completion.
export class GrokLoginAttempts {
  private readonly attempts = new Map<string, Attempt>();
  constructor(private readonly gateway: Pick<LLMGateway, 'connectSubscription' | 'getSubscriptionStatus'>,
    private readonly timeoutMs = 300_000, private readonly capacity = 128) {}

  private prune() {
    for (const [user, attempt] of this.attempts) {
      if (attempt.settled && attempt.expiresAt <= Date.now()) this.attempts.delete(user);
    }
  }
  private user(userId: string) {
    if (!userId) throw new ProviderError('Authenticated user is required', 401, 'grok');
    this.prune();
  }
  private snapshot(attempt: Attempt) {
    return { id: attempt.id, state: attempt.state, messages: [...attempt.messages] };
  }
  latest(userId: string) {
    this.user(userId);
    const attempt = this.attempts.get(userId);
    return attempt ? this.snapshot(attempt) : null;
  }
  get(userId: string, id: string) {
    this.user(userId);
    const attempt = this.attempts.get(userId);
    if (!attempt || attempt.id !== id) throw new ProviderError('Login attempt not found', 404, 'grok');
    return this.snapshot(attempt);
  }
  start(userId: string) {
    this.user(userId);
    const current = this.attempts.get(userId);
    if (current && !current.settled) return this.snapshot(current);
    if (!current && this.attempts.size >= this.capacity)
      throw new ProviderError('Login capacity reached', 429, 'grok');
    const attempt: Attempt = { id: randomUUID(), state: 'pending', messages: [], bytes: 0,
      controller: new AbortController(), expiresAt: Infinity, settled: false };
    this.attempts.set(userId, attempt);
    // run() observes every rejection; no request signal owns this process.
    void this.run(userId, attempt);
    return this.snapshot(attempt);
  }
  cancel(userId: string, id: string) {
    this.get(userId, id);
    const attempt = this.attempts.get(userId)!;
    if (!attempt.settled) {
      attempt.state = 'cancelling';
      attempt.messages = [];
      attempt.controller.abort();
    }
    return this.snapshot(attempt);
  }
  isRunning(userId: string) {
    this.user(userId);
    return this.attempts.get(userId)?.settled === false;
  }
  private async run(userId: string, attempt: Attempt) {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      attempt.state = 'cancelling';
      attempt.messages = [];
      attempt.controller.abort();
    }, this.timeoutMs);
    timer.unref();
    try {
      for await (const message of this.gateway.connectSubscription('grok', userId, attempt.controller.signal)) {
        attempt.controller.signal.throwIfAborted();
        attempt.bytes += Buffer.byteLength(message, 'utf8');
        if (attempt.bytes > 16_384 || attempt.messages.length >= 128)
          throw new Error('Login output limit exceeded');
        attempt.messages.push(message);
      }
      attempt.controller.signal.throwIfAborted();
      const status = await this.gateway.getSubscriptionStatus('grok', userId, attempt.controller.signal);
      attempt.controller.signal.throwIfAborted();
      attempt.state = status.connected ? 'completed' : 'failed';
    } catch {
      attempt.state = timedOut ? 'timed_out' : attempt.controller.signal.aborted ? 'cancelled' : 'failed';
    } finally {
      clearTimeout(timer);
      attempt.controller.abort();
      attempt.messages = [];
      attempt.settled = true;
      attempt.expiresAt = Date.now() + 600_000;
    }
  }
}
