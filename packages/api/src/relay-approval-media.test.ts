import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockState, mockDbFactory, makeChain } from './routes/test-utils.js';
const writes = vi.hoisted(() => ({ inserts: vi.fn() }));
vi.mock('@axiom/db', async () => ({
  ...(await vi.importActual<typeof import('@axiom/db')>('@axiom/db')),
  ...mockDbFactory(),
  db: { transaction: async (callback: (tx: unknown) => unknown) => {
    const chain = makeChain();
    return callback(new Proxy(chain, { get(target, key) {
      if (key === 'insert') return (...args: unknown[]) => { writes.inserts(...args); return makeChain(); };
      return target[key];
    } }));
  } },
  getPublishingConsentStatus: vi.fn(async () => ({ ok: true, missing: [] })),
  getTosScanState: vi.fn(async () => 'completed'),
}));
vi.mock('@axiom/worker', async () => {
  const actual = await vi.importActual<typeof import('@axiom/worker')>('@axiom/worker');
  return { ...actual, enqueueJob: vi.fn(), resolveCapabilities: vi.fn(actual.resolveCapabilities) };
});
import { relayCommandExecutor } from './index.js';
import { enqueueJob, resolveCapabilities } from '@axiom/worker';

const orgId = '11111111-1111-4111-8111-111111111111';
const bundleId = '22222222-2222-4222-8222-222222222222';
const cardId = '33333333-3333-4333-8333-333333333333';
const modelId = '44444444-4444-4444-8444-444444444444';
const asset = { id: 'asset-1', orgId, modelId, kind: 'image' };
const actions = ['approve', 'approve_all', 'publish_now', 'reschedule'] as const;
function fixture(assets: unknown[], platforms = ['instagram'], state = 'generated', assetId: string | null = asset.id) {
  mockState.results = [[], { rows: [{ org_id: orgId, bundle_id: bundleId }] }, [],
    [{ channel: 'telegram', externalRef: 'chat-1' }], [],
    [{ id: bundleId, modelId, state, assetId,
      captions: Object.fromEntries(platforms.map(p => [p, 'Caption'])),
      tosReport: { verdict: 'pass', scores: platforms.map(platform => ({ platform, verdict: 'pass' })) } }],
    ...(assetId ? [assets] : []),
    platforms.map(platform => ({ id: `connection-${platform}`, platform })),
    [{ id: bundleId }], ...platforms.map(() => [{ id: 'target-1' }]),
  ];
}
const run = (action: typeof actions[number]) => relayCommandExecutor(action, cardId,
  { scheduledFor: '2035-01-01T12:00:00Z' }, { channel: 'telegram', sourceId: 'chat-1' });
beforeEach(() => {
  mockState.result = []; mockState.results = []; mockState.updates = [];
  writes.inserts.mockClear(); vi.mocked(enqueueJob).mockClear();
});
function noWrites() {
  expect(mockState.updates).toHaveLength(0);
  expect(writes.inserts).not.toHaveBeenCalled();
  expect(enqueueJob).not.toHaveBeenCalled();
}
describe('Relay approval asset boundary', () => {
  it.each(actions)('rejects unavailable assets for %s', async action => {
    fixture([], ['instagram'], action === 'reschedule' ? 'hold' : 'generated');
    await expect(run(action)).rejects.toThrow('unavailable or unsupported media asset');
    noWrites();
  });
  it.each([
    { ...asset, orgId: 'foreign-org' }, { ...asset, modelId: 'foreign-model' },
    { ...asset, id: 'different-asset' }, { ...asset, kind: 'audio' },
  ])('rejects invalid asset identity or kind %j', async invalid => {
    fixture([invalid]);
    await expect(run('approve')).rejects.toThrow('unavailable or unsupported media asset');
    noWrites();
  });
  it('checks every destination before any mutation', async () => {
    fixture([asset], ['instagram', 'youtube']);
    await expect(run('approve_all')).rejects.toThrow('youtube does not support image assets');
    noWrites();
  });
  it.each(actions)('preserves valid image approval via %s', async action => {
    fixture([asset]);
    await expect(run(action)).resolves.toContain('approved');
    expect(enqueueJob).toHaveBeenCalledOnce();
    expect(mockState.updates).toContainEqual(expect.objectContaining({ state: 'approved' }));
  });
  it('preserves assetless text publishing', async () => {
    fixture([], ['x'], 'generated', null);
    await expect(run('publish_now')).resolves.toContain('immediate publish');
    expect(enqueueJob).toHaveBeenCalledOnce();
  });
  it('preserves compatible video approval', async () => {
    fixture([{ ...asset, kind: 'video' }], ['youtube']);
    await expect(run('approve')).resolves.toContain('approved');
    expect(enqueueJob).toHaveBeenCalledOnce();
  });
  it('fails closed if capability resolution throws', async () => {
    fixture([asset]);
    vi.mocked(resolveCapabilities).mockImplementationOnce(() => { throw new Error('unavailable'); });
    await expect(run('approve')).rejects.toThrow('media support is unknown');
    noWrites();
  });
  it.each(['default', 'publish-intent'])('checks media for the empty-caption %s destination', async source => {
    const platform = source === 'default' ? 'instagram' : 'youtube';
    fixture([asset], [platform]);
    const bundle = (mockState.results[5] as Record<string, unknown>[])[0];
    bundle.captions = {};
    if (source === 'publish-intent') bundle.publishIntent = { action: 'publish', platform, scheduledAt: null };
    if (source === 'default') {
      await expect(run('approve')).resolves.toContain('approved');
      expect(enqueueJob).toHaveBeenCalledOnce();
    } else {
      await expect(run('approve')).rejects.toThrow('youtube does not support image assets');
      noWrites();
    }
  });
});
