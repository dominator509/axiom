import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutorContext } from './context.js';
import type { JobRow } from '../types.js';

const state = vi.hoisted(() => ({
  results: [] as unknown[],
  updates: [] as unknown[],
  locks: [] as string[],
  chat: vi.fn(),
  enqueue: vi.fn(),
}));
vi.mock('@axiom/llm-gateway', async () => ({
  ...(await vi.importActual<typeof import('@axiom/llm-gateway')>('@axiom/llm-gateway')),
  LLMGateway: class {
    chat = state.chat;
  },
}));
vi.mock('../enqueue.js', () => ({ enqueueJob: state.enqueue }));
vi.mock('../viral-retrieval.js', () => ({ retrieveTopExemplars: vi.fn(async () => []) }));
import { contentGenerate } from './generate.js';

function chain(): ExecutorContext['tx'] {
  return new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === 'then')
        return (resolve: (value: unknown) => void) =>
          Promise.resolve(state.results.shift() ?? []).then(resolve);
      if (prop === 'set')
        return (value: unknown) => {
          state.updates.push(value);
          return chain();
        };
      if (prop === 'for')
        return (mode: string) => {
          state.locks.push(mode);
          return chain();
        };
      return () => chain();
    },
  });
}
const bundle = {
  id: 'bundle-1',
  modelId: 'model-1',
  state: 'revising',
  assetId: 'asset-1',
  hashtags: ['original'],
  captions: { instagram: 'Original IG', threads: 'Original Threads' },
  tosReport: { verdict: 'pending', revisionId: 'revision-1' },
};
function job(): JobRow {
  return {
    id: 'job-1',
    org_id: 'org-1',
    queue: 'content',
    kind: 'content.generate',
    payload: {
      bundleId: bundle.id,
      revision: { id: 'revision-1', instructions: 'Make it warmer', userId: 'operator-1' },
    },
    state: 'running',
    attempts: 1,
    max_attempts: 3,
    last_error: null,
    run_after: new Date(),
    locked_by: 'worker-1',
    locked_at: new Date(),
    dedupe_key: null,
    scheduled_for: null,
    started_at: new Date(),
    completed_at: null,
    created_at: new Date(),
  };
}
function execute(input = job()) {
  return contentGenerate({
    tx: chain(),
    job: input,
    workerId: 'worker-1',
    killSwitchEnabled: false,
  });
}
beforeEach(() => {
  state.results = [[bundle], [{ id: bundle.modelId, displayName: 'Model', handle: 'model' }], []];
  state.updates = [];
  state.locks = [];
  state.chat
    .mockReset()
    .mockResolvedValueOnce({ content: 'Revised IG' })
    .mockResolvedValueOnce({ content: 'Revised Threads' });
  state.enqueue.mockReset().mockResolvedValue({ id: 'scan-1' });
});

describe('content.generate caption revisions', () => {
  it('sends actual captions and instructions through S3 and preserves media/hashtags', async () => {
    await execute();
    expect(state.locks).toEqual(['update']);
    expect(state.chat).toHaveBeenCalledTimes(2);
    const messages = state.chat.mock.calls[0][0];
    expect(messages[0].content).toContain('Original IG');
    expect(messages[0].content).toContain('Make it warmer');
    expect(state.chat.mock.calls[1][0][0].content).toContain('Original Threads');
    expect(state.chat.mock.calls[0][1]).toEqual({ model: undefined, userId: 'operator-1' });
    expect(state.updates).toEqual([
      {
        captions: { instagram: 'Revised IG', threads: 'Revised Threads' },
        state: 'generated',
        tosReport: { verdict: 'pending', revisionId: 'revision-1' },
        updatedAt: expect.any(Date),
      },
    ]);
    expect(state.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'tos.scan',
        payload: { bundleId: bundle.id },
        dedupeParts: ['tos.scan', bundle.id, 'revision-1'],
      }),
    );
  });
  it('rolls back without partial content or a scan when a provider fails', async () => {
    state.chat
      .mockReset()
      .mockResolvedValueOnce({ content: 'Revised IG' })
      .mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(execute()).rejects.toThrow('provider unavailable');
    expect(state.updates).toHaveLength(0);
    expect(state.enqueue).not.toHaveBeenCalled();
  });
  it.each(['', '   ', 'x'.repeat(32001)])('rejects invalid completion output', async (content) => {
    state.chat.mockReset().mockResolvedValue({ content });
    await expect(execute()).rejects.toThrow('invalid revised caption');
    expect(state.updates).toHaveLength(0);
  });
  it('does not claim unchanged content was revised', async () => {
    state.chat
      .mockReset()
      .mockResolvedValueOnce({ content: 'Original IG' })
      .mockResolvedValueOnce({ content: 'Original Threads' });
    await expect(execute()).rejects.toThrow('unchanged captions');
    expect(state.enqueue).not.toHaveBeenCalled();
  });
  it.each([
    { ...bundle, state: 'approved' },
    { ...bundle, tosReport: { revisionId: 'newer-revision' } },
  ])('rejects stale revision jobs before provider calls', async (current) => {
    state.results[0] = [current];
    await expect(execute()).rejects.toThrow('stale revision');
    expect(state.chat).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
  });
  it('does not let an old initial-generation job overwrite a published bundle', async () => {
    state.results[0] = [{ ...bundle, state: 'published' }];
    const initial = job();
    initial.payload = { bundleId: bundle.id };
    await expect(execute(initial)).rejects.toThrow('no longer awaiting generation');
    expect(state.chat).not.toHaveBeenCalled();
  });
  it('does not let an old initial-generation job erase a completed revision', async () => {
    state.results[0] = [{ ...bundle, state: 'generated' }];
    const initial = job();
    initial.payload = { bundleId: bundle.id };
    await expect(execute(initial)).rejects.toThrow('no longer awaiting generation');
    expect(state.chat).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
  });
});
