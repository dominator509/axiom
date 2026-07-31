// ─── CommandRouter — Vitest Suite ───
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { CommandRouter, type CardAction } from './commands.js';

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
    const expected = createHmac('sha256', SECRET)
      .update(`${nonce}:approve:bundle-1`)
      .digest('hex');
    expect(router.signCommand(nonce, 'approve', 'bundle-1')).toBe(expected);
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
});

describe('processCommand / getAuditLog', () => {
  it('records a successful command in the audit log', async () => {
    const result = await router.processCommand('bundle-1', 'approve', { note: 'ok' });
    expect(result.success).toBe(true);
    expect(result.cardId).toBe('bundle-1');
    expect(result.action).toBe('approve');
    expect(result.timestamp).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();

    const log = router.getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ cardId: 'bundle-1', action: 'approve' });
  });

  it('getAuditLog returns a copy, not a live reference', async () => {
    await router.processCommand('b1', 'hold');
    const log = router.getAuditLog();
    log.pop();
    expect(router.getAuditLog()).toHaveLength(1);
  });

  it('accumulates multiple commands in order', async () => {
    const actions: CardAction[] = ['approve', 'reject', 'hold', 'revise', 'regenerate', 'edit_caption', 'change_price', 'reschedule', 'approve_all'];
    for (const a of actions) {
      await router.processCommand(`b-${a}`, a);
    }
    const log = router.getAuditLog();
    expect(log).toHaveLength(9);
    expect(log.map((r) => r.action)).toEqual(actions);
  });
});
