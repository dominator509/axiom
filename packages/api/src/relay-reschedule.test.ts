import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockState, mockDbFactory } from './routes/test-utils.js';

vi.mock('@axiom/db', async () => ({
  ...(await vi.importActual<typeof import('@axiom/db')>('@axiom/db')),
  ...mockDbFactory(),
}));
vi.mock('@axiom/worker', async () => ({
  ...(await vi.importActual<typeof import('@axiom/worker')>('@axiom/worker')),
  enqueueJob: vi.fn(),
}));

import { relayCommandExecutor } from './index.js';
import { enqueueJob } from '@axiom/worker';

const orgId = '11111111-1111-4111-8111-111111111111';
const bundleId = '22222222-2222-4222-8222-222222222222';
const cardId = '33333333-3333-4333-8333-333333333333';
const target = { id: 'target-1', platform: 'instagram', state: 'pending', remoteId: null };

beforeEach(() => {
  mockState.result = [];
  mockState.updates = [];
  vi.mocked(enqueueJob).mockClear();
  mockState.results = [
    [], // resolver organization context
    { rows: [{ org_id: orgId, bundle_id: bundleId }] },
    [], // tenant context
    [{ channel: 'telegram', externalRef: 'chat-1' }],
    [], // no previously recorded command
    [{ id: bundleId, state: 'approved' }],
    [target],
  ];
});

const reschedule = () =>
  relayCommandExecutor(
    'reschedule',
    cardId,
    {
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    },
    { channel: 'telegram', sourceId: 'chat-1' },
  );

describe('relay reschedule provider boundary', () => {
  it('reschedules a target that has not reached the provider', async () => {
    mockState.results.push([], [], [{ id: target.id }]);
    await expect(reschedule()).resolves.toContain('rescheduled for');
    expect(mockState.updates).toContainEqual(
      expect.objectContaining({ scheduledFor: expect.any(Date) }),
    );
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId,
        kind: 'publish.target',
        payload: { targetId: target.id },
      }),
    );
  });

  it('rejects a pending target with an asynchronous provider ID', async () => {
    mockState.results[6] = [{ ...target, remoteId: 'provider-publish-id' }];
    await expect(reschedule()).rejects.toThrow(
      'reschedule is not allowed after publication begins',
    );
    expect(mockState.updates).toHaveLength(0);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it.each(['job', 'marker'])('rejects an unknown outcome recorded in the %s', async (source) => {
    mockState.results.push(
      ...(source === 'job' ? [[{ id: 'dead-job' }]] : [[], [{ id: 'dispatch-marker' }]]),
    );
    await expect(reschedule()).rejects.toThrow(
      'provider outcome is unknown; reconcile before rescheduling',
    );
    expect(mockState.updates).toHaveLength(0);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('checks every target before changing any schedule', async () => {
    mockState.results[6] = [target, { ...target, id: 'target-2' }];
    mockState.results.push([], [], [], [{ id: 'second-target-marker' }]);
    await expect(reschedule()).rejects.toThrow('provider outcome is unknown');
    expect(mockState.updates).toHaveLength(0);
    expect(enqueueJob).not.toHaveBeenCalled();
  });
});
