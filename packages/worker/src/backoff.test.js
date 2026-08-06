import { describe, it, expect } from 'vitest';
import { backoffDelayMs, describeDelay } from './backoff.js';
describe('backoffDelayMs', () => {
    it('exponential: base * 2^attempts with jitter disabled', () => {
        expect(backoffDelayMs(0, { jitter: 0, baseMs: 5000 })).toBe(5000);
        expect(backoffDelayMs(1, { jitter: 0, baseMs: 5000 })).toBe(10000);
        expect(backoffDelayMs(2, { jitter: 0, baseMs: 5000 })).toBe(20000);
        expect(backoffDelayMs(3, { jitter: 0, baseMs: 5000 })).toBe(40000);
    });
    it('caps at the configured cap (default 1h)', () => {
        expect(backoffDelayMs(20, { jitter: 0, baseMs: 5000 })).toBe(3_600_000);
        expect(backoffDelayMs(30, { jitter: 0, baseMs: 5000 })).toBe(3_600_000);
    });
    it('never goes negative with jitter', () => {
        for (let i = 0; i < 100; i++) {
            const d = backoffDelayMs(i % 5, { baseMs: 1000 });
            expect(d).toBeGreaterThanOrEqual(0);
        }
    });
    it('jitter stays within ±fraction of the base exponential', () => {
        // attempt=1 → base 1000 * 2^1 = 2000; jitter ±20% → [1600, 2400]
        for (let i = 0; i < 200; i++) {
            const d = backoffDelayMs(1, { baseMs: 1000, jitter: 0.2 });
            expect(d).toBeGreaterThanOrEqual(1600);
            expect(d).toBeLessThanOrEqual(2400);
        }
    });
});
describe('describeDelay', () => {
    it('formats ms, seconds, minutes', () => {
        expect(describeDelay(500)).toBe('500ms');
        expect(describeDelay(1500)).toBe('1.5s');
        expect(describeDelay(120000)).toBe('2.0m');
    });
});
//# sourceMappingURL=backoff.test.js.map