import { describe, it, expect, vi, beforeEach } from 'vitest';
// ─── Chainable transaction mock (mirrors api test-utils pattern) ───
// NOTE: vi.mock factories are hoisted above imports, so all state referenced
// by the factory must be defined inside the factory itself.
const mockState = { result: [] };
function makeChain() {
    const handler = {
        get(_t, prop) {
            if (prop === 'then') {
                return (resolve, reject) => {
                    Promise.resolve(mockState.result).then(resolve, reject);
                };
            }
            return () => makeChain();
        },
        apply() {
            return makeChain();
        },
    };
    return new Proxy(function () { }, handler);
}
vi.mock('@axiom/db', () => {
    const schemaProxy = new Proxy({
        orgSettings: {},
        job: {},
        postTarget: {},
        contentBundle: {},
        modelProfile: {},
        idempotencyLedger: {},
        postMetric: {},
        viralExemplar: {},
        viralRecipe: {},
        viralEmbedding: {},
        relayBinding: {},
        auditLog: {},
    }, {
        get(target, prop) {
            if (prop in target)
                return target[prop];
            return {};
        },
    });
    return {
        db: {
            transaction: vi.fn(async (cb) => cb(makeChain())),
        },
        schema: schemaProxy,
    };
});
import { workerTick, processJob } from './worker.js';
import { defaultExecutors } from './executors/index.js';
import { ParkJobError } from './executors/context.js';
function makeJob(overrides = {}) {
    return {
        id: '11111111-1111-1111-1111-111111111111',
        org_id: '00000000-0000-0000-0000-000000000000',
        queue: 'test',
        kind: 'test.kind',
        payload: {},
        state: 'ready',
        attempts: 0,
        max_attempts: 3,
        last_error: null,
        run_after: new Date(),
        locked_by: null,
        locked_at: null,
        dedupe_key: null,
        scheduled_for: null,
        started_at: null,
        completed_at: null,
        created_at: new Date(),
        ...overrides,
    };
}
describe('workerTick with empty queue', () => {
    beforeEach(() => {
        mockState.result = [];
    });
    it('reports an empty poll when claim_job returns no rows', async () => {
        // db.transaction runs the callback; claimNextJob executes sql → our
        // chainable returns mockState.result ([]) → empty.
        const stats = await workerTick({ pollIntervalMs: 5 });
        expect(stats.emptyPolls).toBe(1);
        expect(stats.claimed).toBe(0);
    });
});
describe('processJob state transitions', () => {
    beforeEach(() => {
        mockState.result = [];
    });
    it('marks done on executor success', async () => {
        const job = makeJob({ kind: 'test.ok' });
        const executor = vi.fn(async () => { });
        const outcome = await processJob(job, { 'test.ok': executor }, 'w1', {});
        expect(outcome).toBe('done');
        expect(executor).toHaveBeenCalledTimes(1);
    });
    it('retries with backoff on executor failure (attempts+1, run_after future)', async () => {
        const job = makeJob({ kind: 'test.fail', attempts: 0, max_attempts: 3 });
        const executor = vi.fn(async () => {
            throw new Error('boom');
        });
        const outcome = await processJob(job, { 'test.fail': executor }, 'w1', {});
        expect(outcome).toBe('retry');
    });
    it('goes dead when attempts reach max_attempts', async () => {
        const job = makeJob({ kind: 'test.fail', attempts: 2, max_attempts: 3 });
        const executor = vi.fn(async () => {
            throw new Error('boom');
        });
        const outcome = await processJob(job, { 'test.fail': executor }, 'w1', {});
        expect(outcome).toBe('dead');
    });
    it('parks the job on ParkJobError without consuming attempts', async () => {
        const job = makeJob({ kind: 'test.park', attempts: 0, max_attempts: 3 });
        const executor = vi.fn(async () => {
            throw new ParkJobError('kill switch', 60_000);
        });
        const outcome = await processJob(job, { 'test.park': executor }, 'w1', {});
        expect(outcome).toBe('parked');
    });
    it('throws for an unknown job kind', async () => {
        const job = makeJob({ kind: 'unknown.kind' });
        await expect(processJob(job, defaultExecutors, 'w1', {})).rejects.toThrow(/no executor/);
    });
});
describe('default executor registry', () => {
    it('covers the full L3.4 taxonomy', () => {
        expect(Object.keys(defaultExecutors).sort()).toEqual([
            'content.generate',
            'tos.scan',
            'relay.card',
            'publish.target',
            'metrics.poll',
            'viral.label',
            'incident.notify',
            'dlq.replay',
        ].sort());
    });
});
//# sourceMappingURL=worker.test.js.map