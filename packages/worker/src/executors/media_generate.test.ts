import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutorContext } from './context.js';
import type { JobRow } from '../types.js';
const state = vi.hoisted(() => ({
  rows: [] as unknown[], markerRows: [] as unknown[], events: [] as string[],
  generate: vi.fn(), store: vi.fn(), enqueue: vi.fn(),
}));
vi.mock('@axiom/llm-gateway', async original => ({ ...await original<typeof import('@axiom/llm-gateway')>(),
  OfficialSubscriptionTransport: class { generateMedia = state.generate; } }));
vi.mock('../generated-asset-store.js', () => ({ storeGeneratedAsset: state.store }));
vi.mock('../enqueue.js', () => ({ enqueueJob: state.enqueue }));
import { mediaGenerate } from './media_generate.js';

function chain(rows = state.rows): any {
  return new Proxy(() => {}, { get(_target, key) {
    if (key === 'then') return (resolve: (value: unknown) => void) => Promise.resolve(rows.shift() ?? []).then(resolve);
    return () => chain(rows);
  } });
}
function context(): ExecutorContext {
  return {
    tx: chain(), workerId: 'worker', killSwitchEnabled: false,
    job: {
      id: 'job', org_id: 'org', queue: 'content', kind: 'media.generate', state: 'running',
      attempts: 1, max_attempts: 3, last_error: null, run_after: new Date(),
      locked_by: 'worker', locked_at: new Date(), dedupe_key: null,
      scheduled_for: null, started_at: new Date(), completed_at: null, created_at: new Date(),
      payload: { bundleId: 'bundle', userId: 'user', kind: 'image', prompt: 'Landscape' },
    } satisfies JobRow,
    persistSideEffectMarker: async operation => {
      state.events.push('marker');
      return operation(chain(state.markerRows));
    },
    markExternalSideEffect: () => { state.events.push('side-effect'); },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [[{ id: 'user', role: 'operator' }], [{ id: 'bundle', modelId: 'model', state: 'generated' }], [{ id: 'asset' }]];
  state.markerRows = [[{ jobId: 'job' }]];
  state.events = [];
  state.generate.mockImplementation(async (_request, beforeDispatch) => {
    await beforeDispatch();
    state.events.push('provider');
    return { path: '/request/session/images/1.jpg', mimeType: 'image/jpeg', byteLength: 23 };
  });
  state.store.mockResolvedValue({ storageKey: 'generated/file.jpg', fileName: 'file.jpg', fileSize: 23, sha256: Buffer.alloc(32) });
  state.enqueue.mockResolvedValue(undefined);
});
describe('one-shot media worker', () => {
  it('enforces requested sanitization before enqueueing visual ToS', async () => {
    const ctx = context();
    ctx.job.payload = { ...ctx.job.payload, sanitizeMetadata: true };
    state.store.mockRejectedValueOnce(new Error('Sanitization failed'));
    await expect(mediaGenerate(ctx)).rejects.toThrow('Sanitization failed');
    expect(state.store).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sanitizeMetadata: true }));
    expect(state.enqueue).not.toHaveBeenCalled();
    expect(state.generate).toHaveBeenCalledOnce();
  });
  it('uses the job character-lock snapshot verbatim when dispatching', async () => {
    const ctx = context();
    ctx.job.payload = { ...ctx.job.payload, characterLockPrompt: 'Freckles and green eyes', characterLockVersion: 3 };
    await mediaGenerate(ctx);
    expect(state.generate).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'CHARACTER / PERSONA — preserve this identity:\nFreckles and green eyes\n\nSCENE:\nLandscape',
    }), expect.any(Function));
  });
  it('rejects malformed lock snapshots before dispatch', async () => {
    const ctx = context();
    ctx.job.payload = { ...ctx.job.payload, characterLockPrompt: 'Missing revision' };
    await expect(mediaGenerate(ctx)).rejects.toThrow('Invalid character lock snapshot');
    expect(state.events).toEqual([]);
    expect(state.generate).not.toHaveBeenCalled();
  });
  it('rejects an unsupported provider before persisting a dispatch or calling Grok', async () => {
    const ctx = context();
    ctx.job.payload = { ...ctx.job.payload, provider: 'unsupported-provider' };
    await expect(mediaGenerate(ctx)).rejects.toThrow('invalid request');
    expect(state.events).toEqual([]);
    expect(state.generate).not.toHaveBeenCalled();
  });
  it('accepts the manager role authorized by the generation API', async () => {
    state.rows[0] = [{ id: 'user', role: 'manager' }];
    await mediaGenerate(context());
    expect(state.generate).toHaveBeenCalledOnce();
  });
  it('forwards the selected image aspect ratio', async () => {
    const ctx = context();
    ctx.job.payload = { ...ctx.job.payload, aspectRatio: '4:5' };
    await mediaGenerate(ctx);
    expect(state.generate).toHaveBeenCalledWith(expect.objectContaining({ aspectRatio: '4:5' }), expect.any(Function));
  });
  it('rejects unsupported image geometry before committing a dispatch', async () => {
    const ctx = context();
    ctx.job.payload = { ...ctx.job.payload, aspectRatio: '99:1' };
    await expect(mediaGenerate(ctx)).rejects.toThrow('invalid request');
    expect(state.events).toEqual([]);
  });
  it('commits dispatch before generation, persists asset and queues ToS', async () => {
    await mediaGenerate(context());
    expect(state.events).toEqual(['marker', 'side-effect', 'provider']);
    expect(state.store).toHaveBeenCalledOnce();
    expect(state.enqueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      kind: 'tos.scan', payload: { bundleId: 'bundle' }, dedupeParts: ['tos.scan', 'bundle', 'asset'],
    }));
  });
  it('never calls provider again when a durable dispatch already exists', async () => {
    state.markerRows = [[]];
    await expect(mediaGenerate(context())).rejects.toThrow('reconciliation');
    expect(state.generate).toHaveBeenCalledOnce(); // Preparation only; callback refuses dispatch.
    expect(state.events).toEqual(['marker', 'side-effect']);
  });
  it('rejects revoked tenant membership before a paid call', async () => {
    state.rows = [[]];
    await expect(mediaGenerate(context())).rejects.toThrow('authorized');
    expect(state.events).toEqual([]);
  });
  it('does not retry or enqueue ToS after provider failure', async () => {
    state.generate.mockImplementation(async (_request, beforeDispatch) => {
      await beforeDispatch();
      throw new Error('unknown provider outcome');
    });
    await expect(mediaGenerate(context())).rejects.toThrow('unknown provider outcome');
    expect(state.generate).toHaveBeenCalledOnce();
    expect(state.store).not.toHaveBeenCalled();
    expect(state.enqueue).not.toHaveBeenCalled();
  });
  it('requires the independent durable marker transaction', async () => {
    const ctx = context();
    ctx.persistSideEffectMarker = undefined;
    await expect(mediaGenerate(ctx)).rejects.toThrow('durable');
    expect(state.generate).not.toHaveBeenCalled();
  });
  it('does not commit a dispatch marker for a transport preparation failure', async () => {
    state.generate.mockRejectedValue(new Error('Reconnect Grok OAuth'));
    await expect(mediaGenerate(context())).rejects.toThrow('Reconnect');
    expect(state.events).toEqual([]);
    expect(state.store).not.toHaveBeenCalled();
    expect(state.enqueue).not.toHaveBeenCalled();
  });
});
