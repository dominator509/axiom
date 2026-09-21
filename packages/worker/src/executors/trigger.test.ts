import { beforeEach, describe, expect, it, vi } from 'vitest';

const { enqueueJob } = vi.hoisted(() => ({ enqueueJob: vi.fn(async () => ({ id: 'job-1' })) }));

vi.mock('@axiom/db', () => {
  const table = new Proxy<Record<string, string>>({}, { get: (_target, property) => String(property) });
  const schema = new Proxy<Record<string, unknown>>({}, { get: () => table });
  return { schema };
});

vi.mock('../connection.js', () => ({ asPlatform: (value: string) => value }));
vi.mock('../enqueue.js', () => ({ enqueueJob }));

import { resolveLearnedP90Threshold, triggerEvaluate } from './trigger.js';

function chain(result: unknown, onResolve?: () => void) {
  const value: Record<string, unknown> = {};
  for (const method of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) value[method] = () => value;
  value.then = (resolve: (result: unknown) => void, reject?: (error: unknown) => void) => {
    onResolve?.();
    return Promise.resolve(result).then(resolve, reject);
  };
  return value;
}

function transaction(results: unknown[]) {
  let index = 0;
  let updateCount = 0;
  const tx = {
    select: () => chain(results[index++]),
    update: () => {
      const update = chain([]);
      update.set = () => update;
      update.where = () => update;
      updateCount += 1;
      return update;
    },
  };
  return { tx, updates: () => updateCount, reads: () => index };
}

const job = { org_id: 'org-1', payload: { targetId: 'target-1' } };

beforeEach(() => enqueueJob.mockClear());

describe('learned trigger thresholds', () => {
  it('fails closed for missing, invalid, or undersampled aggregates', () => {
    expect(resolveLearnedP90Threshold(undefined)).toBeNull();
    expect(resolveLearnedP90Threshold({ threshold: 'not-a-number', sampleCount: 4 })).toBeNull();
    expect(resolveLearnedP90Threshold({ threshold: 20, sampleCount: 3 })).toBeNull();
    expect(resolveLearnedP90Threshold({ threshold: 20, sampleCount: 4 })).toBe(20);
  });

  it('uses the server percentile only after the provider distribution meets the sample floor', async () => {
    const ready = transaction([
      [{ id: 'target-1', platform: 'instagram', bundleId: 'bundle-1' }],
      [{ modelId: 'model-1' }],
      [{ id: 'rule-1', condition: { metric: 'likes', thresholdMode: 'learned_p90', minimumSamples: 4 }, action: { type: 'content.generate' }, lastFiredAt: null }],
      [{ likes: 120 }],
      [{ threshold: 100, sampleCount: 4 }],
    ]);
    await triggerEvaluate({ tx: ready.tx, job } as never);
    expect(enqueueJob).toHaveBeenCalledTimes(1);
    expect(ready.reads()).toBe(5);
    expect(ready.updates()).toBe(1);

    enqueueJob.mockClear();
    const insufficient = transaction([
      [{ id: 'target-1', platform: 'instagram', bundleId: 'bundle-1' }],
      [{ modelId: 'model-1' }],
      [{ id: 'rule-1', condition: { metric: 'likes', thresholdMode: 'learned_p90', minimumSamples: 4 }, action: { type: 'content.generate' }, lastFiredAt: null }],
      [{ likes: 120 }],
      [{ threshold: 100, sampleCount: 3 }],
    ]);
    await triggerEvaluate({ tx: insufficient.tx, job } as never);
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(insufficient.updates()).toBe(0);
  });
});
