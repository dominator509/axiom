import { afterEach, describe, expect, it, vi } from 'vitest';
import { GrokLoginAttempts } from './grok-login-attempts.js';
import { ProviderError } from './providers/types.js';

afterEach(() => vi.useRealTimers());
function fixture(connected = true) {
  let finish!: () => void;
  let signal!: AbortSignal;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const gateway = {
    connectSubscription: vi.fn((_provider: string, _user: string, incoming?: AbortSignal) => (async function* () {
      signal = incoming!;
      yield 'Authorize using the provider page';
      await Promise.race([wait, new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))]);
    })()),
    getSubscriptionStatus: vi.fn(async () => ({ provider: 'grok' as const, connected })),
  };
  return { gateway, finish: () => finish(), signal: () => signal };
}
describe('Grok login attempt ownership', () => {
  it('refuses a replacement when transport termination is unconfirmed', async () => {
    const f = fixture();
    f.gateway.connectSubscription.mockImplementation(() => (async function* () {
      yield 'Provider instructions';
      throw new ProviderError('Subscription login termination could not be confirmed', 503, 'grok');
    })());
    const attempts = new GrokLoginAttempts(f.gateway);
    const first = attempts.start('one');
    await vi.waitFor(() => expect(attempts.get('one', first.id).state).toBe('failed'));
    expect(attempts.isRunning('one')).toBe(true);
    expect(attempts.start('one').id).toBe(first.id);
    expect(f.gateway.connectSubscription).toHaveBeenCalledTimes(1);
    expect(attempts.get('one', first.id).messages).toEqual([]);
  });
  it('survives the initiating observation and deduplicates concurrent starts', async () => {
    const f = fixture(); const attempts = new GrokLoginAttempts(f.gateway);
    const first = attempts.start('one');
    expect(attempts.start('one').id).toBe(first.id);
    await vi.waitFor(() => expect(attempts.get('one', first.id).messages).toHaveLength(1));
    expect(f.signal().aborted).toBe(false);
    expect(f.gateway.connectSubscription).toHaveBeenCalledTimes(1);
    f.finish();
    await vi.waitFor(() => expect(attempts.get('one', first.id).state).toBe('completed'));
    expect(attempts.latest('one')?.messages).toEqual([]);
  });
  it('does not reveal or cancel another user attempt', async () => {
    const f = fixture(); const attempts = new GrokLoginAttempts(f.gateway);
    const first = attempts.start('one');
    expect(attempts.latest('two')).toBeNull();
    expect(() => attempts.get('two', first.id)).toThrow('not found');
    expect(() => attempts.cancel('two', first.id)).toThrow('not found');
    expect(() => attempts.start('')).toThrow('Authenticated');
    f.finish();
    await vi.waitFor(() => expect(attempts.isRunning('one')).toBe(false));
  });
  it('requires the saved credential, not just successful CLI exit', async () => {
    const f = fixture(false); const attempts = new GrokLoginAttempts(f.gateway);
    const first = attempts.start('one'); f.finish();
    await vi.waitFor(() => expect(attempts.get('one', first.id).state).toBe('failed'));
  });
  it('explicit cancellation aborts the owned process and never reports success', async () => {
    const f = fixture(); const attempts = new GrokLoginAttempts(f.gateway);
    const first = attempts.start('one');
    await vi.waitFor(() => expect(attempts.get('one', first.id).messages).toHaveLength(1));
    expect(attempts.cancel('one', first.id).state).toBe('cancelling');
    expect(f.signal().aborted).toBe(true);
    await vi.waitFor(() => expect(attempts.get('one', first.id).state).toBe('cancelled'));
    expect(f.gateway.getSubscriptionStatus).not.toHaveBeenCalled();
  });
  it('expires attempts and releases retained instruction data', async () => {
    vi.useFakeTimers();
    const f = fixture(); const attempts = new GrokLoginAttempts(f.gateway, 100);
    const first = attempts.start('one');
    await vi.advanceTimersByTimeAsync(101);
    expect(attempts.get('one', first.id)).toMatchObject({ state: 'timed_out', messages: [] });
    await vi.advanceTimersByTimeAsync(600_001);
    expect(attempts.latest('one')).toBeNull();
  });
  it('bounds total users and output without leaking provider errors', async () => {
    const f = fixture(); const attempts = new GrokLoginAttempts(f.gateway, 300_000, 1);
    attempts.start('one');
    expect(() => attempts.start('two')).toThrow('capacity');
    f.finish(); await vi.waitFor(() => expect(attempts.isRunning('one')).toBe(false));
    f.gateway.connectSubscription.mockImplementation(() => (async function* () { yield 'x'.repeat(16_385); })());
    const next = attempts.start('one');
    await vi.waitFor(() => expect(attempts.get('one', next.id)).toMatchObject({ state: 'failed', messages: [] }));
  });
});
