// ─── relay.card executor — Vitest Suite ───
// Verifies the durable card row, card-id propagation, and ToS risk-to-safety
// conversion at the worker/channel boundary.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockState = vi.hoisted(() => ({
  results: [] as unknown[],
  sent: [] as Array<{ chatRef: string; card: Record<string, unknown> }>,
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
    contentBundle: { id: 'content_bundle.id' },
    relayBinding: { modelId: 'relay_binding.model_id', enabled: 'relay_binding.enabled' },
    relayCard: { id: 'relay_card.id' },
  },
}));

vi.mock('@axiom/relay', async () => {
  const actual = await vi.importActual<typeof import('@axiom/relay')>('@axiom/relay');
  class TestTelegramAdapter {
    async sendCard(chatRef: string, card: Record<string, unknown>): Promise<void> {
      mockState.sent.push({ chatRef, card });
    }
  }
  return { ...actual, TelegramAdapter: TestTelegramAdapter };
});

import { relayCard } from './relay_card.js';

const JOB = {
  id: 'job-1',
  org_id: 'org-1',
  max_attempts: 8,
  payload: { bundleId: 'bundle-1' },
} as any;

const BUNDLE = {
  id: 'bundle-1',
  modelId: 'model-1',
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
    [{ id: 'binding-1', channel: 'telegram', chatRef: 'chat-1', modelId: 'model-1' }],
    [{ id: 'card-1' }],
    [],
  ];
  mockState.sent = [];
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
});

describe('relayCard', () => {
  it('persists the card id, preserves safe ToS semantics, and sends it to Telegram', async () => {
    await relayCard({
      tx: makeChain(),
      job: JOB,
      killSwitchEnabled: false,
      workerId: 'worker-1',
    });

    expect(mockState.sent).toHaveLength(1);
    expect(mockState.sent[0].chatRef).toBe('chat-1');
    expect(mockState.sent[0].card).toMatchObject({
      cardId: 'card-1',
      bundleId: 'bundle-1',
    });
    expect((mockState.sent[0].card.verdicts as Array<Record<string, unknown>>)[0]).toMatchObject({
      platform: 'instagram',
      passed: true,
      score: 1,
    });
  });
});
