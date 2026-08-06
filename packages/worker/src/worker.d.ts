import type { Executor } from './executors/context.js';
import type { JobRow } from './types.js';
export interface WorkerOptions {
    workerId?: string;
    /** Milliseconds to sleep when the queue is empty. Default 1000. */
    pollIntervalMs?: number;
    /** Milliseconds to sleep after a run (backpressure). Default 50. */
    settleMs?: number;
    /** Executor map override (tests). */
    executors?: Record<string, Executor>;
    /** Max attempts before a job goes dead. Default 3 (schema default). */
    maxAttempts?: number;
}
export interface WorkerStats {
    claimed: number;
    done: number;
    failed: number;
    dead: number;
    parked: number;
    emptyPolls: number;
    lastError: string | null;
    running: boolean;
}
/** Read org kill-switch state inside the org-scoped txn (L3.4 §5). */
export declare function readKillSwitch(tx: any, orgId: string): Promise<boolean>;
/**
 * Process a single claimed job in its own transaction. Returns the outcome.
 * Must be called with org context set (claim_job does it in the same txn).
 */
export declare function processJob(job: JobRow, executors: Record<string, Executor>, workerId: string, opts: {
    maxAttempts?: number;
}): Promise<'done' | 'retry' | 'dead' | 'parked'>;
/** Run one claim→process cycle. Returns stats delta for the caller. */
export declare function workerTick(opts?: WorkerOptions): Promise<WorkerStats>;
/** Continuous worker loop; resolves on shutdown signal. */
export declare function runWorker(opts?: WorkerOptions): Promise<void>;
//# sourceMappingURL=worker.d.ts.map