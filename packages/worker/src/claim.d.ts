import type { JobRow } from './types.js';
export interface ClaimResult {
    job: JobRow | null;
    /** True when the queue is empty (no ready job). */
    empty: boolean;
}
/**
 * Claim the next ready job for this worker. Must run inside a transaction —
 * the returned job's org context is set on the session for the rest of it.
 */
export declare function claimNextJob(tx: any, workerId: string): Promise<ClaimResult>;
//# sourceMappingURL=claim.d.ts.map