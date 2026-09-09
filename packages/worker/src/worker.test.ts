import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Chainable transaction mock (mirrors api test-utils pattern) ───
// NOTE: vi.mock factories are hoisted above imports, so all state referenced
// by the factory must be defined inside the factory itself.
const mockState: { result: unknown; executeResult?: unknown } = { result: [] };

function makeChain(result = mockState.result): any {
  const handler = {
    get(_t: unknown, prop: string | symbol) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
          Promise.resolve(result).then(resolve, reject);
        };
      }
      if (prop === 'execute') {
        return () => makeChain(mockState.executeResult ?? mockState.result);
      }
      return () => makeChain();
    },
    apply() {
      return makeChain();
    },
  };
  return new Proxy(function () {}, handler);
}

vi.mock('@axiom/db', () => {
  const schemaProxy = new Proxy<Record<string, unknown>>(
    {
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
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop as string];
        return {};
      },
    },
  );
  return {
    db: {
      transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(makeChain())),
    },
    schema: schemaProxy,
  };
});

import { readKillSwitch, workerTick, processJob } from './worker.js';
import { defaultExecutors } from './executors/index.js';
import { ParkJobError } from './executors/context.js';
import type { JobRow } from './types.js';

function makeJob(overrides: Partial<JobRow> = {}): JobRow {
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

  it('reports the handled job error for the long-running loop', async () => {
    const job = makeJob({ kind: 'test.fail' });
    mockState.result = [job];
    mockState.executeResult = { rows: [job] };

    const stats = await workerTick({
      executors: {
        'test.fail': async () => {
          throw new Error('provider timeout');
        },
      },
    });

    expect(stats.claimed).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.lastError).toBe('provider timeout');
  });
});

describe('readKillSwitch', () => {
  beforeEach(() => {
    mockState.executeResult = undefined;
  });

  it('fails closed when the organization has no settings row', async () => {
    mockState.result = [];
    await expect(readKillSwitch(makeChain(), 'org-1')).resolves.toBe(true);
  });

  it('allows publishing only when settings explicitly enable it', async () => {
    mockState.result = [{ publishingEnabled: true }];
    await expect(readKillSwitch(makeChain(), 'org-1')).resolves.toBe(false);

    mockState.result = [{ publishingEnabled: false }];
    await expect(readKillSwitch(makeChain(), 'org-1')).resolves.toBe(true);
  });
});

describe('processJob state transitions', () => {
  beforeEach(() => {
    mockState.result = [{ id: 'job-1', publishingEnabled: true }];
  });

  it('marks done on executor success', async () => {
    const job = makeJob({ kind: 'test.ok' });
    const executor = vi.fn(async () => {});
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

  it('dead-letters instead of retrying after an external side effect starts', async () => {
    const job = makeJob({ kind: 'test.external', attempts: 0, max_attempts: 3 });
    const executor = vi.fn(async (ctx: { markExternalSideEffect?: () => void }) => {
      ctx.markExternalSideEffect?.();
      throw new Error('provider response lost');
    });
    const outcome = await processJob(job, { 'test.external': executor }, 'w1', {});
    expect(outcome).toBe('dead');
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('parks the job on ParkJobError without consuming attempts', async () => {
    const job = makeJob({ kind: 'test.park', attempts: 0, max_attempts: 3 });
    const executor = vi.fn(async () => {
      throw new ParkJobError('kill switch', 60_000);
    });
    const outcome = await processJob(job, { 'test.park': executor }, 'w1', {});
    expect(outcome).toBe('parked');
  });

  it('surfaces lease loss instead of reporting a completed job', async () => {
    mockState.result = [];
    const job = makeJob({ kind: 'test.ok' });
    const executor = vi.fn(async () => {});

    await expect(processJob(job, { 'test.ok': executor }, 'w1', {})).rejects.toThrow(
      'lease ownership lost before state transition',
    );
  });

  it('fails closed when a heartbeat loses lease ownership', async () => {
    vi.useFakeTimers();
    try {
      mockState.result = [{ id: 'job-1', publishingEnabled: true }];
      let releaseExecutor!: () => void;
      let markExternalSideEffect!: () => void;
      const executor = vi.fn(async (ctx: { markExternalSideEffect?: () => void }) => {
        markExternalSideEffect = ctx.markExternalSideEffect!;
        await new Promise<void>((resolve) => {
          releaseExecutor = resolve;
        });
      });
      const job = makeJob({ kind: 'test.heartbeat' });
      const processing = processJob(job, { 'test.heartbeat': executor }, 'w1', {});

      await vi.advanceTimersByTimeAsync(0);
      expect(markExternalSideEffect).toBeTypeOf('function');

      // The next renewal observes that the row is no longer owned by w1.
      mockState.result = [];
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(() => markExternalSideEffect()).toThrow('lease ownership lost during execution');

      releaseExecutor();
      await expect(processing).rejects.toThrow('lease ownership lost during execution');
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws for an unknown job kind', async () => {
    const job = makeJob({ kind: 'unknown.kind' });
    await expect(processJob(job, defaultExecutors, 'w1', {})).rejects.toThrow(/no executor/);
  });
});

describe('default executor registry', () => {
  it('covers the full L3.4 taxonomy', () => {
    expect(Object.keys(defaultExecutors).sort()).toEqual(
      [
        'content.generate',
        'tos.scan',
        'relay.card',
        'publish.target',
        'metrics.poll',
        'viral.label',
        'incident.notify',
        'dlq.replay',
        'digest.weekly',
      ].sort(),
    );
  });
});
