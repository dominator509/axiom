// ─── Backoff schedule (L3.4 §3) ───
// min(cap, base * 2^attempts) ± jitter — default base 5s, cap 1h.
/** Deterministic exponent for tests (jitter = 0). */
export function backoffDelayMs(attempts, opts = {}) {
    const baseMs = opts.baseMs ?? 5000;
    const capMs = opts.capMs ?? 3_600_000;
    const jitter = opts.jitter ?? 0.2;
    const exponential = Math.min(capMs, baseMs * Math.pow(2, Math.max(0, attempts)));
    if (jitter <= 0)
        return exponential;
    const spread = exponential * jitter;
    const offset = Math.random() * spread * 2 - spread;
    return Math.max(0, Math.round(exponential + offset));
}
/** Human-readable delay for logs. */
export function describeDelay(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    if (ms < 60_000)
        return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60_000).toFixed(1)}m`;
}
//# sourceMappingURL=backoff.js.map