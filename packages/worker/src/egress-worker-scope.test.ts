import { describe, expect, it, vi } from 'vitest';
import {
  EGRESS_JOB_KINDS,
  assertEgressWorkerNamespace,
  claimNextModelEgressJob,
  claimNextNonEgressJob,
  resolveEgressConfinementRequired,
  resolveEgressWorkerScope,
} from './claim.js';

const modelId = '22222222-2222-4222-8222-222222222222';

describe('model egress worker scope', () => {
  it('requires both a bounded model identity and explicit runner marker', () => {
    expect(resolveEgressWorkerScope({})).toBeUndefined();
    expect(resolveEgressWorkerScope({ WORKER_EGRESS_MODEL_ID: modelId, AXIOM_EGRESS_RUNNER: '1' }))
      .toEqual({ modelId });
    for (const env of [
      { WORKER_EGRESS_MODEL_ID: modelId },
      { AXIOM_EGRESS_RUNNER: '1' },
      { WORKER_EGRESS_MODEL_ID: '*', AXIOM_EGRESS_RUNNER: '1' },
      { WORKER_EGRESS_MODEL_ID: modelId, AXIOM_EGRESS_RUNNER: 'true' },
    ]) expect(() => resolveEgressWorkerScope(env)).toThrow('model-scoped egress runner');
  });

  it('does not silently treat malformed confinement as disabled', () => {
    expect(resolveEgressConfinementRequired({})).toBe(false);
    expect(resolveEgressConfinementRequired({ AXIOM_EGRESS_CONFINEMENT_REQUIRED: '1' })).toBe(true);
    expect(() => resolveEgressConfinementRequired({ AXIOM_EGRESS_CONFINEMENT_REQUIRED: 'yes' })).toThrow('exactly 1');
  });

  it('checks the exact kernel namespace identity before egress execution', () => {
    const readlink = vi.fn((path: string) => path.startsWith('/run/netns/') ? 'net:[41]' : 'net:[41]');
    expect(() => assertEgressWorkerNamespace({ modelId }, { platform: 'linux', readlink })).not.toThrow();
    expect(readlink).toHaveBeenCalledWith(`/run/netns/egress_${modelId}`);
    expect(() => assertEgressWorkerNamespace({ modelId }, {
      platform: 'linux', readlink: path => path.startsWith('/run/netns/') ? 'net:[41]' : 'net:[42]',
    })).toThrow('not running in its assigned network namespace');
    expect(() => assertEgressWorkerNamespace({ modelId }, { platform: 'win32' })).toThrow('Linux network namespace');
  });

  it('uses scoped database claims and keeps the egress job set explicit', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    await expect(claimNextModelEgressJob({ execute }, 'runner', { modelId })).resolves.toEqual({ job: null, empty: true });
    await expect(claimNextNonEgressJob({ execute }, 'global')).resolves.toEqual({ job: null, empty: true });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(EGRESS_JOB_KINDS).toEqual(['publish.target', 'metrics.poll', 'scrape.run', 'fanvue.analytics.sync', 'public.sfw.reply']);
  });
});
