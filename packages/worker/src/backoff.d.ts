export interface BackoffOptions {
    baseMs?: number;
    capMs?: number;
    /** Jitter as a fraction of the computed delay (0..1). Default 0.2. */
    jitter?: number;
}
/** Deterministic exponent for tests (jitter = 0). */
export declare function backoffDelayMs(attempts: number, opts?: BackoffOptions): number;
/** Human-readable delay for logs. */
export declare function describeDelay(ms: number): string;
//# sourceMappingURL=backoff.d.ts.map