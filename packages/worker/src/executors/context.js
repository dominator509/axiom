// ─── Executor contract ───
// Each executor runs inside the claim transaction (org RLS context already
// set by claim_job). It performs the domain work; throwing aborts and the
// worker applies retry/backoff/dead. Executors that must gate on the global
// kill switch check org_settings.publishing_enabled inside their txn (L3.4 §5).
/** Signals the worker to park the job back to ready with a delay (kill switch / rate bucket). */
export class ParkJobError extends Error {
    delayMs;
    constructor(message, delayMs) {
        super(message);
        this.delayMs = delayMs;
        this.name = 'ParkJobError';
    }
}
//# sourceMappingURL=context.js.map