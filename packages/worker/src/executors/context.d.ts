import type { JobRow } from '../types.js';
export interface ExecutorContext {
    tx: any;
    job: JobRow;
    workerId: string;
    /** Resolved kill-switch state for the org (checked inside txn). */
    killSwitchEnabled: boolean;
}
export type Executor = (ctx: ExecutorContext) => Promise<void>;
/** Signals the worker to park the job back to ready with a delay (kill switch / rate bucket). */
export declare class ParkJobError extends Error {
    readonly delayMs: number;
    constructor(message: string, delayMs: number);
}
//# sourceMappingURL=context.d.ts.map