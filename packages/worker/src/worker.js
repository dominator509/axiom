// ─── Queue worker main loop (L3.4 §3) ───
// One transaction per claim: claim_job() (SKIP LOCKED + org context) → run the
// executor → mark done. Errors: backoff into ready, or dead (DLQ) at
// max_attempts. Kill-switch parks re-queue with a delay instead of failing.
import { sql } from 'drizzle-orm';
import { db, schema } from '@axiom/db';
import { backoffDelayMs } from './backoff.js';
import { claimNextJob } from './claim.js';
import { defaultExecutors } from './executors/index.js';
import { ParkJobError } from './executors/context.js';
/** Read org kill-switch state inside the org-scoped txn (L3.4 §5). */
export async function readKillSwitch(tx, orgId) {
    const rows = await tx
        .select({ publishingEnabled: schema.orgSettings.publishingEnabled })
        .from(schema.orgSettings)
        .where(sql `${schema.orgSettings.orgId} = ${orgId}`)
        .limit(1);
    if (rows.length === 0)
        return false; // default: publishing enabled
    return !rows[0].publishingEnabled;
}
/**
 * Process a single claimed job in its own transaction. Returns the outcome.
 * Must be called with org context set (claim_job does it in the same txn).
 */
export async function processJob(job, executors, workerId, opts) {
    const executor = executors[job.kind];
    if (!executor) {
        throw new Error(`worker: no executor for kind '${job.kind}'`);
    }
    try {
        // claim_job set the org context only for ITS transaction; this executor
        // runs in a fresh txn, so set the org context from the claimed job first
        // (RLS scopes every query in the txn, LBI-02).
        const result = await db.transaction(async (tx) => {
            await tx.execute(sql `SELECT set_config('app.current_org_id', ${job.org_id}, true)`);
            const killSwitchEnabled = await readKillSwitch(tx, job.org_id);
            await executor({ tx, job, workerId, killSwitchEnabled });
            await tx
                .update(schema.job)
                .set({ state: 'done', completedAt: new Date(), lastError: null, lockedBy: null, lockedAt: null })
                .where(sql `${schema.job.id} = ${job.id}`);
            return 'done';
        });
        return result;
    }
    catch (err) {
        if (err instanceof ParkJobError) {
            await db.transaction(async (tx) => {
                await tx.execute(sql `SELECT set_config('app.current_org_id', ${job.org_id}, true)`);
                await tx
                    .update(schema.job)
                    .set({
                    state: 'ready',
                    runAfter: new Date(Date.now() + err.delayMs),
                    lastError: err.message,
                    lockedBy: null,
                    lockedAt: null,
                })
                    .where(sql `${schema.job.id} = ${job.id}`);
            });
            return 'parked';
        }
        const message = err.message ?? String(err);
        const attempts = (job.attempts ?? 0) + 1;
        const maxAttempts = opts.maxAttempts ?? job.max_attempts ?? 3;
        if (attempts >= maxAttempts) {
            await db.transaction(async (tx) => {
                await tx.execute(sql `SELECT set_config('app.current_org_id', ${job.org_id}, true)`);
                await tx
                    .update(schema.job)
                    .set({ state: 'dead', lastError: message, lockedBy: null, lockedAt: null })
                    .where(sql `${schema.job.id} = ${job.id}`);
            });
            return 'dead';
        }
        const delayMs = backoffDelayMs(attempts);
        await db.transaction(async (tx) => {
            await tx.execute(sql `SELECT set_config('app.current_org_id', ${job.org_id}, true)`);
            await tx
                .update(schema.job)
                .set({
                state: 'ready',
                attempts,
                lastError: message,
                runAfter: new Date(Date.now() + delayMs),
                lockedBy: null,
                lockedAt: null,
            })
                .where(sql `${schema.job.id} = ${job.id}`);
        });
        return 'retry';
    }
}
/** Run one claim→process cycle. Returns stats delta for the caller. */
export async function workerTick(opts = {}) {
    const workerId = opts.workerId ?? `worker-${process.pid}`;
    const executors = opts.executors ?? defaultExecutors;
    const stats = {
        claimed: 0,
        done: 0,
        failed: 0,
        dead: 0,
        parked: 0,
        emptyPolls: 0,
        lastError: null,
        running: true,
    };
    const claimed = await db.transaction(async (tx) => {
        const { job, empty } = await claimNextJob(tx, workerId);
        if (empty || !job)
            return null;
        return job;
    });
    if (!claimed) {
        stats.emptyPolls = 1;
        return stats;
    }
    stats.claimed = 1;
    const outcome = await processJob(claimed, executors, workerId, {
        maxAttempts: opts.maxAttempts,
    });
    if (outcome === 'done')
        stats.done = 1;
    else if (outcome === 'retry')
        stats.failed = 1;
    else if (outcome === 'dead')
        stats.dead = 1;
    else
        stats.parked = 1;
    return stats;
}
/** Continuous worker loop; resolves on shutdown signal. */
export async function runWorker(opts = {}) {
    const workerId = opts.workerId ?? `worker-${process.pid}`;
    const pollIntervalMs = opts.pollIntervalMs ?? 1000;
    const settleMs = opts.settleMs ?? 50;
    const executors = opts.executors ?? defaultExecutors;
    let shuttingDown = false;
    const stop = () => {
        shuttingDown = true;
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    console.log(`[worker] ${workerId} started (poll ${pollIntervalMs}ms)`);
    while (!shuttingDown) {
        try {
            const stats = await workerTick({ ...opts, workerId, executors });
            if (stats.claimed === 0) {
                await sleep(pollIntervalMs);
            }
            else if (stats.lastError) {
                console.error(`[worker] ${stats.lastError}`);
            }
            if (stats.claimed > 0)
                await sleep(settleMs);
        }
        catch (err) {
            console.error('[worker] tick error:', err.message);
            await sleep(pollIntervalMs);
        }
    }
    console.log(`[worker] ${workerId} stopped`);
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=worker.js.map