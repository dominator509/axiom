export interface EnqueueJobInput {
    orgId: string;
    queue: string;
    kind: string;
    payload: Record<string, unknown>;
    /** ISO string or Date; default now. */
    runAfter?: Date;
    /** Unit-of-work parts for the dedupe key. Omit to allow duplicates. */
    dedupeParts?: Array<string | number>;
    maxAttempts?: number;
}
/**
 * Insert a job row via the caller's transaction (org context must be set by
 * the caller — withOrgContext in the API, claim_job in the worker).
 */
export declare function enqueueJob(tx: any, input: EnqueueJobInput): Promise<{
    id: string;
} | null>;
//# sourceMappingURL=enqueue.d.ts.map