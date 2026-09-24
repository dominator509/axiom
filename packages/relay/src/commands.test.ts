// ─── CommandRouter — Vitest Suite ───
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { CommandRouter } from './commands.js';

const SECRET = 'test-signing-secret';

let router: CommandRouter;

beforeEach(() => {
  router = new CommandRouter(SECRET, 5); // 5 minute TTL
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('generateNonce', () => {
  it('produces unique 32-char hex nonces', () => {
    const a = router.generateNonce();
    const b = router.generateNonce();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe('signCommand / verifyCommand', () => {
  it('verifies a correctly signed command', () => {
    const nonce = router.generateNonce();
    const sig = router.signCommand(nonce, 'approve', 'bundle-1');
    expect(router.verifyCommand(sig, nonce, 'approve', 'bundle-1')).toBe(true);
  });

  it('verification is deterministic — a signature verifies even after a time gap', () => {
    // Regression test for the Date.now() non-determinism bug: signatures were
    // only verifiable if sign+verify happened in the same millisecond.
    const nonce = router.generateNonce();
    const sig = router.signCommand(nonce, 'reject', 'bundle-2');
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 5000); // simulate network round-trip delay
    expect(router.verifyCommand(sig, nonce, 'reject', 'bundle-2')).toBe(true);
    vi.useRealTimers();
  });

  it('rejects a tampered signature', () => {
    const nonce = router.generateNonce();
    const sig = router.signCommand(nonce, 'approve', 'bundle-1');
    expect(router.verifyCommand(sig, nonce, 'approve', 'bundle-EVIL')).toBe(false);
    expect(router.verifyCommand('deadbeef', nonce, 'approve', 'bundle-1')).toBe(false);
  });

  it('rejects a signature for a different action', () => {
    const nonce = router.generateNonce();
    const sig = router.signCommand(nonce, 'approve', 'bundle-1');
    expect(router.verifyCommand(sig, nonce, 'reject', 'bundle-1')).toBe(false);
  });

  it('rejects signatures of a different length without throwing', () => {
    const nonce = router.generateNonce();
    expect(router.verifyCommand('short', nonce, 'approve', 'bundle-1')).toBe(false);
    expect(router.verifyCommand('', nonce, 'approve', 'bundle-1')).toBe(false);
  });

  it('matches the expected raw HMAC computation', () => {
    const nonce = 'abc123';
    const expected = createHmac('sha256', SECRET).update(`${nonce}:approve:bundle-1`).digest('hex');
    expect(router.signCommand(nonce, 'approve', 'bundle-1')).toBe(expected);
  });
});

describe('compact provider command tokens', () => {
  it('round-trips UUID card ids within the Telegram payload limit', () => {
    const cardId = '00000000-0000-0000-0000-000000000001';
    const token = router.createCommandToken('approve_all', cardId);

    expect(token.length).toBeLessThanOrEqual(64);
    expect(router.verifyCommandToken(token)).toEqual({ action: 'approve_all', cardId });
  });

  it('round-trips non-UUID ids for compatible standalone callers', () => {
    const token = router.createCommandToken('hold', 'card-1');
    expect(router.verifyCommandToken(token)).toEqual({ action: 'hold', cardId: 'card-1' });
  });

  it('round-trips the appended publish-now action without changing prior action codes', () => {
    const token = router.createCommandToken('publish_now', 'card-1');
    expect(router.verifyCommandToken(token)).toEqual({ action: 'publish_now', cardId: 'card-1' });
  });

  it('peeks a parameterised token without consuming its one-use nonce', () => {
    const token = router.createCommandToken('edit_caption', 'card-1');
    expect(router.peekCommandToken(token)).toEqual({ action: 'edit_caption', cardId: 'card-1' });
    expect(router.verifyCommandToken(token)).toEqual({ action: 'edit_caption', cardId: 'card-1' });
  });

  it('rejects tampering and replay', () => {
    const token = router.createCommandToken('approve', 'card-1');
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;

    expect(router.verifyCommandToken(tampered)).toBeNull();
    expect(router.verifyCommandToken(token, 'reject')).toBeNull();
    expect(router.verifyCommandToken(token)).toEqual({ action: 'approve', cardId: 'card-1' });
    expect(router.verifyCommandToken(token)).toBeNull();
  });

  it('allows a token to be used again only after its TTL expires', () => {
    const token = router.createCommandToken('hold', 'card-1');
    expect(router.verifyCommandToken(token)).not.toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    expect(router.verifyCommandToken(token)).toEqual({ action: 'hold', cardId: 'card-1' });
    vi.useRealTimers();
  });
});

describe('nonce reuse protection', () => {
  it('rejects replay of the same nonce with a valid signature', () => {
    const nonce = router.generateNonce();
    const sig = router.signCommand(nonce, 'approve', 'bundle-1');
    expect(router.verifyCommand(sig, nonce, 'approve', 'bundle-1')).toBe(true);
    // Second use of the same nonce must be rejected
    expect(router.verifyCommand(sig, nonce, 'approve', 'bundle-1')).toBe(false);
  });

  it('a failed verification does not consume the nonce', () => {
    const nonce = router.generateNonce();
    const sig = router.signCommand(nonce, 'approve', 'bundle-1');
    expect(router.verifyCommand('bogus', nonce, 'approve', 'bundle-1')).toBe(false);
    // Nonce is not stored on failure, so a correct signature still verifies
    expect(router.verifyCommand(sig, nonce, 'approve', 'bundle-1')).toBe(true);
  });

  it('allows reuse of an expired nonce (entry cleaned up)', () => {
    const nonce = router.generateNonce();
    const sig = router.signCommand(nonce, 'hold', 'bundle-1');
    expect(router.verifyCommand(sig, nonce, 'hold', 'bundle-1')).toBe(true);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 6 * 60 * 1000); // past the 5-minute TTL
    // Re-verification of the same (now expired) nonce succeeds again
    expect(router.verifyCommand(sig, nonce, 'hold', 'bundle-1')).toBe(true);
    vi.useRealTimers();
  });
});

describe('cleanupExpiredNonces', () => {
  it('removes only expired entries', () => {
    vi.useFakeTimers();
    const n1 = router.generateNonce();
    const s1 = router.signCommand(n1, 'approve', 'b1');
    router.verifyCommand(s1, n1, 'approve', 'b1'); // stored with TTL from now

    vi.setSystemTime(Date.now() + 10 * 60 * 1000); // 10 min later

    const n2 = router.generateNonce();
    const s2 = router.signCommand(n2, 'approve', 'b2');
    router.verifyCommand(s2, n2, 'approve', 'b2'); // stored with fresh TTL

    router.cleanupExpiredNonces();
    // n1 expired → deleted; n2 still valid
    expect(router.verifyCommand(s1, n1, 'approve', 'b1')).toBe(true); // re-usable: was cleaned
    expect(router.verifyCommand(s2, n2, 'approve', 'b2')).toBe(false); // still stored → reuse rejected
    vi.useRealTimers();
  });

  it('reclaims expired entries during normal verification', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const first = router.createCommandToken('approve', 'card-1');
    expect(router.verifyCommandToken(first)).not.toBeNull();

    vi.advanceTimersByTime(6 * 60 * 1000);
    const second = router.createCommandToken('approve', 'card-2');
    expect(router.verifyCommandToken(second)).not.toBeNull();

    const nonces = (router as unknown as { nonces: Map<string, unknown> }).nonces;
    expect(nonces.size).toBe(1);
    vi.useRealTimers();
  });
});

describe('processCommand', () => {
  it('fails closed when no durable executor is configured', async () => {
    const result = await router.processCommand('bundle-1', 'approve', { note: 'ok' });
    expect(result).toMatchObject({
      success: false,
      cardId: 'bundle-1',
      action: 'approve',
      error: 'relay command executor not configured',
    });
    expect(result.timestamp).toBeGreaterThan(0);
  });
});

describe('processCommand with injected executor (H-3 DB wiring)', () => {
  it('invokes the executor and surfaces its result note', async () => {
    const executor = vi.fn().mockResolvedValue('bundle abc123 → approved');
    const r = new CommandRouter('secret', 5, executor);
    const result = await r.processCommand('card-1', 'approve', { note: 'ok' });
    expect(executor).toHaveBeenCalledWith('approve', 'card-1', { note: 'ok' });
    expect(result.success).toBe(true);
    expect(result.error).toBe('bundle abc123 → approved');
  });

  it('marks the command failed when the executor throws', async () => {
    const executor = vi.fn().mockRejectedValue(new Error('bundle not found'));
    const r = new CommandRouter('secret', 5, executor);
    const result = await r.processCommand('card-2', 'reject', {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('bundle not found');
  });

  it('executes commands without creating a process-local success record', async () => {
    const executor = vi.fn().mockResolvedValue(undefined);
    const r = new CommandRouter('secret', 5, executor);
    await r.processCommand('card-3', 'hold', {});
    expect(executor).toHaveBeenCalledOnce();
  });
});
