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

const editCaption = () =>
  relayCommandExecutor(
    'edit_caption',
    cardId,
    { platform: 'instagram', caption: 'Updated caption' },
    { channel: 'telegram', sourceId: 'chat-1' },
  );

describe('relay caption edit approval boundary', () => {
  it.each(['generated', 'hold', 'approved'])(
    'invalidates old approval and queues fresh ToS from %s',
    async (state) => {
      mockState.results[5] = [
        {
          id: bundleId,
          state,
          captions: { instagram: 'Original', threads: 'Preserve this' },
          tosReport: { verdict: 'pass' },
        },
      ];
      mockState.results.push([], [], [{ id: bundleId }]);
      await expect(editCaption()).resolves.toContain('fresh ToS scan and approval required');
      expect(mockState.updates).toEqual([
        expect.objectContaining({
          state: 'generated',
          captions: { instagram: 'Updated caption', threads: 'Preserve this' },
          tosReport: { verdict: 'pending', revisionId: expect.any(String) },
        }),
        { state: 'canceled', error: 'caption edited; fresh approval required' },
      ]);
      const version = (mockState.updates[0] as { tosReport: { revisionId: string } }).tosReport
        .revisionId;
      expect(enqueueJob).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: 'tos.scan',
          payload: { bundleId },
          dedupeParts: ['tos.scan', bundleId, version],
        }),
      );
    },
  );

  it.each(['job', 'marker'])(
    'rejects unknown provider outcomes in the %s before any mutation',
    async (source) => {
      mockState.results.push(
        ...(source === 'job' ? [[{ id: 'unknown-job' }]] : [[], [{ id: 'dispatch-marker' }]]),
      );
      await expect(editCaption()).rejects.toThrow('provider outcome is unknown');
      expect(mockState.updates).toHaveLength(0);
      expect(enqueueJob).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ...target, remoteId: 'provider-id' },
    { ...target, state: 'published' },
  ])('rejects a target that reached publication', async (published) => {
    mockState.results[6] = [published];
    await expect(editCaption()).rejects.toThrow('publication begins');
    expect(mockState.updates).toHaveLength(0);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('checks every destination before editing the bundle', async () => {
    mockState.results[6] = [target, { ...target, id: 'target-2' }];
    mockState.results.push([], [], [], [{ id: 'second-target-unknown' }]);
    await expect(editCaption()).rejects.toThrow('provider outcome is unknown');
    expect(mockState.updates).toHaveLength(0);
  });

  it('allows a later edit when previous targets were safely canceled', async () => {
    mockState.results[5] = [{ id: bundleId, state: 'generated' }];
    mockState.results[6] = [{ ...target, state: 'canceled' }];
    mockState.results.push([], [], [{ id: bundleId }]);
    await expect(editCaption()).resolves.toContain('fresh ToS scan');
    expect(enqueueJob).toHaveBeenCalledTimes(1);
  });
});

describe('relay reschedule provider boundary', () => {
  it('rejects an old card after the bundle is revised', async () => {
    mockState.results[5] = [
      { id: bundleId, state: 'approved', tosReport: { revisionId: 'new-revision' } },
    ];
    await expect(reschedule()).rejects.toThrow('card is superseded');
    expect(mockState.updates).toHaveLength(0);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it.each(['revise', 'regenerate'] as const)(
    'queues real generation for relay %s',
    async (action) => {
      mockState.results[5] = [{ id: bundleId, state: 'generated' }];
      mockState.results[6] = [{ id: bundleId, state: 'revising' }];
      await expect(
        relayCommandExecutor(
          action,
          cardId,
          { instructions: 'Use a warmer tone' },
          { channel: 'telegram', sourceId: 'chat-1' },
        ),
      ).resolves.toContain('revision queued');
      expect(mockState.updates).toContainEqual(expect.objectContaining({ state: 'revising' }));
      expect(enqueueJob).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: 'content.generate',
          payload: {
            bundleId,
            revision: {
              id: expect.any(String),
              instructions: 'Use a warmer tone',
              userId: undefined,
            },
          },
        }),
      );
    },
  );

  it('reschedules a target that has not reached the provider', async () => {
    mockState.results[3] = [
      { channel: 'telegram', externalRef: 'chat-1', config: { revisionId: 'revision-1' } },
    ];
    mockState.results[5] = [
      { id: bundleId, state: 'approved', tosReport: { revisionId: 'revision-1' } },
    ];
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
