// ─── relay.card executor — Vitest Suite ───
// Verifies the durable card row, card-id propagation, and ToS risk-to-safety
// conversion at the worker/channel boundary.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockState = vi.hoisted(() => ({
  results: [] as unknown[],
  sent: [] as Array<{ chatRef: string; card: Record<string, unknown> }>,
  inserts: [] as unknown[],
  discordLogins: 0,
  discordDestroys: 0,
}));

function makeChain(): any {
  const handler = {
    get(_target: unknown, prop: string | symbol) {
      if (prop === 'then') {
        return (resolve: (value: unknown) => void, reject?: (error: unknown) => void) => {
          const value = mockState.results.length > 0 ? mockState.results.shift() : [];
          Promise.resolve(value).then(resolve, reject);
        };
      }
      if (prop === 'values') {
        return (value: unknown) => {
          mockState.inserts.push(value);
          return makeChain();
        };
      }
      return () => makeChain();
    },
    apply() {
      return makeChain();
    },
  };
  return new Proxy(function () {}, handler);
}

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
}));

vi.mock('@axiom/db', () => ({
  schema: {
    asset: { id: 'asset.id', orgId: 'asset.org_id', modelId: 'asset.model_id' },
    contentBundle: { id: 'content_bundle.id', orgId: 'content_bundle.org_id' },
    relayBinding: { modelId: 'relay_binding.model_id', enabled: 'relay_binding.enabled' },
    relayCard: {
      id: 'relay_card.id',
      orgId: 'relay_card.org_id',
      bundleId: 'relay_card.bundle_id',
      channel: 'relay_card.channel',
      externalRef: 'relay_card.external_ref',
      state: 'relay_card.state',
    },
  },
}));

vi.mock('@axiom/relay', async () => {
  const actual = await vi.importActual<typeof import('@axiom/relay')>('@axiom/relay');
  class TestTelegramAdapter {
    async sendCard(chatRef: string, card: Record<string, unknown>): Promise<void> {
      mockState.sent.push({ chatRef, card });
    }
  }
  class TestDiscordAdapter {
    async login(): Promise<void> {
      mockState.discordLogins += 1;
    }

    getClient(): { destroy: () => void } {
      return { destroy: () => mockState.discordDestroys++ };
    }

    async sendCard(chatRef: string, card: Record<string, unknown>): Promise<void> {
      mockState.sent.push({ chatRef, card });
    }
  }
  return {
    ...actual,
    TelegramAdapter: TestTelegramAdapter,
    DiscordAdapter: TestDiscordAdapter,
  };
});

import { assertRelayBindingDispatchable, relayCard } from './relay_card.js';
import type { ExecutorContext } from './context.js';

const JOB = {
  id: 'job-1',
  org_id: 'org-1',
  max_attempts: 8,
  payload: { bundleId: 'bundle-1' },
} as any;

const BUNDLE = {
  id: 'bundle-1',
  state: 'generated',
  modelId: 'model-1',
  assetId: 'asset-1',
  hashtags: ['safe'],
  captions: { instagram: 'A safe caption' },
  tosReport: {
    verdict: 'pass',
    scores: [{ platform: 'instagram', score: 0, verdict: 'pass' }],
  },
};

beforeEach(() => {
  mockState.results = [
    [BUNDLE],
    [
      {
        id: 'asset-1',
        orgId: 'org-1',
        modelId: 'model-1',
        kind: 'image',
        storageKey: 'models/model-1/image.jpg',
      },
    ],
    [{ id: 'binding-1', channel: 'telegram', chatRef: 'chat-1', modelId: 'model-1' }],
    [],
    [{ id: 'card-1' }],
    [],
  ];
  mockState.sent = [];
  mockState.inserts = [];
  mockState.discordLogins = 0;
  mockState.discordDestroys = 0;
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
  vi.stubEnv('AXIOM_ASSET_DELIVERY_BASE_URL', 'https://media.example.test/assets');
});

describe('relayCard', () => {
  it.each(['generated', 'hold'])('still dispatches actionable %s bundles', async (state) => {
    mockState.results[0] = [{ ...BUNDLE, state }];
    await relayCard({ tx: makeChain(), job: JOB, killSwitchEnabled: false, workerId: 'worker-1' });
    expect(mockState.sent).toHaveLength(1);
  });

  it.each([undefined, null, 'unknown'])('refuses an unknown lifecycle state (%s)', async (state) => {
    mockState.results[0] = [{ ...BUNDLE, state }];
    await expect(relayCard({
      tx: makeChain(), job: JOB, killSwitchEnabled: false, workerId: 'worker-1',
    })).rejects.toThrow('unknown bundle lifecycle state');
    expect(mockState.sent).toHaveLength(0);
    expect(mockState.inserts).toHaveLength(0);
  });

  it.each(['approved', 'scheduled', 'publishing', 'published', 'rejected', 'revising'])(
    'finishes obsolete approval-card work for a %s bundle without dispatch', async (state) => {
      mockState.results[0] = [{ ...BUNDLE, state }];
      const markExternalSideEffect = vi.fn();
      const persistSideEffectMarker = vi.fn(async (operation) => operation(makeChain()));
      await relayCard({
        tx: makeChain(), job: JOB, killSwitchEnabled: false, workerId: 'worker-1',
        markExternalSideEffect, persistSideEffectMarker,
      });
      expect(mockState.sent).toHaveLength(0);
      expect(mockState.inserts).toHaveLength(0);
      expect(markExternalSideEffect).not.toHaveBeenCalled();
      expect(persistSideEffectMarker).not.toHaveBeenCalled();
      expect(mockState.results).toHaveLength(5);
    },
  );

  it('preflights unsupported bindings before any provider dispatch', () => {
    expect(() =>
      assertRelayBindingDispatchable({
        id: 'binding-1',
        channel: 'threads',
        chatRef: 'chat-1',
      }),
    ).toThrow("channel 'threads' dispatch not implemented");
  });

  it('preflights adapter configuration before any provider dispatch', () => {
    expect(() =>
      assertRelayBindingDispatchable(
        { id: 'binding-1', channel: 'telegram', chatRef: 'chat-1' },
        {},
      ),
    ).toThrow('TELEGRAM_BOT_TOKEN not configured');
  });

  it('fails closed instead of duplicating a card with an unresolved dispatch marker', async () => {
    mockState.results[3] = [{ id: 'pending-card-1' }];
    const markExternalSideEffect = vi.fn();

    await expect(
      relayCard({
        tx: makeChain(),
        job: JOB,
        killSwitchEnabled: false,
        workerId: 'worker-1',
        markExternalSideEffect,
      }),
    ).rejects.toThrow(
      'relay.card: unresolved dispatch marker pending-card-1; provider reconciliation required before retry',
    );

    expect(markExternalSideEffect).toHaveBeenCalledTimes(1);
    expect(mockState.sent).toHaveLength(0);
  });

  it('fails closed when a concurrent job wins the pending-marker insert race', async () => {
    // The pending-dispatch partial unique index turns the losing insert into
    // an empty RETURNING result. Treat that as an unknown provider outcome so
    // the worker dead-letters for reconciliation instead of retrying freely.
    mockState.results[4] = [];
    const markExternalSideEffect = vi.fn();

    await expect(
      relayCard({
        tx: makeChain(),
        job: JOB,
        killSwitchEnabled: false,
        workerId: 'worker-1',
        markExternalSideEffect,
      }),
    ).rejects.toThrow(
      'relay.card: concurrent dispatch marker already exists for bundle-1/telegram/chat-1; provider reconciliation required before retry',
    );

    expect(markExternalSideEffect).toHaveBeenCalledTimes(1);
    expect(mockState.sent).toHaveLength(0);
  });

  it('persists the card id, preserves safe ToS semantics, and sends it to Telegram', async () => {
    mockState.results[0] = [
      { ...BUNDLE, tosReport: { ...BUNDLE.tosReport, revisionId: 'revision-1' } },
    ];
    const markExternalSideEffect = vi.fn();
    const persistSideEffectMarker = vi.fn(async (operation: (markerTx: any) => Promise<unknown>) =>
      operation(makeChain()),
    ) as unknown as NonNullable<ExecutorContext['persistSideEffectMarker']>;
    await relayCard({
      tx: makeChain(),
      job: JOB,
      killSwitchEnabled: false,
      workerId: 'worker-1',
      markExternalSideEffect,
      persistSideEffectMarker,
    });

    expect(mockState.sent).toHaveLength(1);
    expect(markExternalSideEffect).toHaveBeenCalledTimes(1);
    expect(persistSideEffectMarker).toHaveBeenCalledTimes(1);
    expect(mockState.sent[0].chatRef).toBe('chat-1');
    expect(mockState.inserts).toContainEqual(expect.objectContaining({ externalRef: 'chat-1' }));
    expect(mockState.inserts).toContainEqual(
      expect.objectContaining({ config: expect.objectContaining({ revisionId: 'revision-1' }) }),
    );
    expect(mockState.sent[0].card).toMatchObject({
      cardId: 'card-1',
      bundleId: 'bundle-1',
      mediaPreview: 'https://media.example.test/assets/models/model-1/image.jpg',
    });
    expect(mockState.sent[0].card.commandTokens).toEqual({
      approve: expect.any(String),
      approve_all: expect.any(String),
      edit_caption: expect.any(String),
      reschedule: expect.any(String),
      reject: expect.any(String),
      hold: expect.any(String),
      publish_now: expect.any(String),
    });
    expect((mockState.sent[0].card.verdicts as Array<Record<string, unknown>>)[0]).toMatchObject({
      platform: 'instagram',
      passed: true,
      score: 1,
    });
  });

  it('authenticates and closes a one-shot Discord gateway around card delivery', async () => {
    mockState.results[2] = [
      { id: 'binding-1', channel: 'discord', chatRef: 'channel-1', modelId: 'model-1' },
    ];
    vi.stubEnv('DISCORD_BOT_TOKEN', 'discord-token');
    vi.stubEnv('DISCORD_APPLICATION_ID', 'discord-client');

    const markExternalSideEffect = vi.fn();
    const persistSideEffectMarker = vi.fn(async (operation: (markerTx: any) => Promise<unknown>) =>
      operation(makeChain()),
    ) as unknown as NonNullable<ExecutorContext['persistSideEffectMarker']>;

    await relayCard({
      tx: makeChain(),
      job: JOB,
      killSwitchEnabled: false,
      workerId: 'worker-1',
      markExternalSideEffect,
      persistSideEffectMarker,
    });

    expect(mockState.discordLogins).toBe(1);
    expect(mockState.discordDestroys).toBe(1);
    expect(markExternalSideEffect).toHaveBeenCalledTimes(1);
    expect(mockState.sent[0]?.chatRef).toBe('channel-1');
  });

  it('uses the target-platform caption when the relay channel is not a platform key', async () => {
    mockState.results[0] = [
      {
        ...BUNDLE,
        captions: { tiktok: 'TikTok-only caption' },
        hashtags: ['dance'],
      },
    ];

    await relayCard({
      tx: makeChain(),
      job: JOB,
      killSwitchEnabled: false,
      workerId: 'worker-1',
    });

    expect(mockState.sent[0]?.card).toMatchObject({
      caption: 'TikTok-only caption',
      captionVariants: { tiktok: 'TikTok-only caption' },
      hashtagSets: { tiktok: ['dance'] },
      targetPlatforms: ['tiktok'],
    });
  });
});
