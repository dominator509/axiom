import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  results: [] as unknown[],
  values: [] as Array<Record<string, unknown>>,
  sent: [] as Array<{ channel: string; chatRef: string; card: Record<string, unknown> }>,
  marked: 0,
}));

function chain(): any {
  const handler = {
    get(_target: unknown, prop: string | symbol) {
      if (prop === 'then') {
        return (resolve: (value: unknown) => void) => resolve(state.results.shift() ?? []);
      }
      if (prop === 'values') return (value: Record<string, unknown>) => { state.values.push(value); return chain(); };
      if (prop === 'set') return () => chain();
      return () => chain();
    },
    apply() { return chain(); },
  };
  return new Proxy(function () {}, handler);
}

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => 'and'),
  eq: vi.fn(() => 'eq'),
  inArray: vi.fn(() => 'in-array'),
  isNotNull: vi.fn(() => 'not-null'),
}));

vi.mock('@axiom/db', () => ({
  schema: {
    relayCard: {
      id: 'relay_card.id', orgId: 'relay_card.org_id', modelId: 'relay_card.model_id',
      channel: 'relay_card.channel', externalRef: 'relay_card.external_ref',
      state: 'relay_card.state',
    },
    relayBinding: {
      orgId: 'relay_binding.org_id', modelId: 'relay_binding.model_id', enabled: 'relay_binding.enabled',
    },
  },
}));

vi.mock('@axiom/relay', () => {
  class MockCardRenderer {
    renderInsightCard(input: Record<string, unknown>) {
      return { kind: 'insight', bundleId: '', actions: [], ...input };
    }
  }
  class MockTelegramAdapter {
    constructor(_config: unknown) {}
    async sendCard(chatRef: string, card: Record<string, unknown>) {
      state.sent.push({ channel: 'telegram', chatRef, card });
    }
  }
  class MockDiscordAdapter {
    constructor(_config: unknown) {}
    async login() {}
    getClient() { return { destroy: () => undefined }; }
    async sendCard(chatRef: string, card: Record<string, unknown>) {
      state.sent.push({ channel: 'discord', chatRef, card });
    }
  }
  class MockSignalAdapter {
    constructor(_config: unknown) {}
    async sendCard(chatRef: string, card: Record<string, unknown>) {
      state.sent.push({ channel: 'signal', chatRef, card });
    }
  }
  class MockIMessageAdapter {
    constructor(_config: unknown) {}
    async sendCard(chatRef: string, card: Record<string, unknown>) {
      state.sent.push({ channel: 'imessage', chatRef, card });
    }
  }
  return {
    CardRenderer: MockCardRenderer,
    TelegramAdapter: MockTelegramAdapter,
    DiscordAdapter: MockDiscordAdapter,
    SignalAdapter: MockSignalAdapter,
    IMessageAdapter: MockIMessageAdapter,
  };
});

import { ParkJobError } from './context.js';
import { relayInsightCard } from './relay_insight.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const CARD_ID = '33333333-3333-4333-8333-333333333333';

function source() {
  return {
    id: CARD_ID,
    orgId: ORG_ID,
    modelId: MODEL_ID,
    channel: 'viral_insight',
    externalRef: `viral-insight:${MODEL_ID}:2026-08-03`,
    state: 'stored',
    title: 'What is working',
    description: 'Question hooks lead published performance.',
    icon: '📈',
    priority: 4,
    config: {
      viralInsight: {
        groups: [{
          platform: 'instagram',
          learningArm: 'v2:short:question',
          learningContext: 'learn-v2:scheduled-utc-2',
          sampleSize: 14,
          meanScore: 2.3,
          publishedHourUtc: 19,
        }],
      },
    },
  };
}

function context() {
  return {
    tx: chain(),
    job: { org_id: ORG_ID },
    workerId: 'worker-1',
    killSwitchEnabled: false,
    markExternalSideEffect: () => { state.marked += 1; },
  } as any;
}

beforeEach(() => {
  state.results = [];
  state.values = [];
  state.sent = [];
  state.marked = 0;
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
  vi.stubEnv('DISCORD_BOT_TOKEN', 'discord-token');
  vi.stubEnv('DISCORD_APPLICATION_ID', 'discord-app');
});

describe('relayInsightCard', () => {
  it('parks without a binding and performs no provider work', async () => {
    state.results = [[source()], []];
    await expect(relayInsightCard(context(), CARD_ID)).rejects.toBeInstanceOf(ParkJobError);
    expect(state.sent).toEqual([]);
    expect(state.values).toEqual([]);
    expect(state.marked).toBe(0);
  });

  it('preflights every binding before creating a marker', async () => {
    state.results = [[source()], [
      { id: 'binding-1', channel: 'telegram', chatRef: 'chat-1' },
      { id: 'binding-2', channel: 'unsupported', chatRef: 'chat-2' },
    ]];
    await expect(relayInsightCard(context(), CARD_ID)).rejects.toThrow('dispatch not implemented');
    expect(state.values).toEqual([]);
    expect(state.sent).toEqual([]);
  });

  it('persists a pending marker before provider dispatch and marks it sent', async () => {
    state.results = [[source()], [{ id: 'binding-1', channel: 'telegram', chatRef: 'chat-1' }], [], [{ id: 'marker-1' }], []];
    await expect(relayInsightCard(context(), CARD_ID)).resolves.toBeUndefined();
    expect(state.values[0]).toMatchObject({
      orgId: ORG_ID,
      modelId: MODEL_ID,
      channel: 'telegram',
      state: 'pending',
      externalRef: `viral-insight:${MODEL_ID}:2026-08-03:binding:binding-1`,
    });
    expect(state.values[0].config).toMatchObject({ sourceCardId: CARD_ID, externalDelivery: 'attempted' });
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]).toMatchObject({ channel: 'telegram', chatRef: 'chat-1' });
    expect(state.sent[0].card).toMatchObject({ kind: 'insight', cardId: 'marker-1', actions: [] });
    expect(state.marked).toBe(1);
  });

  it('refuses malformed stored evidence before creating a dispatch marker', async () => {
    const invalid = source();
    invalid.config.viralInsight.groups[0].sampleSize = 1;
    state.results = [[invalid], [{ id: 'binding-1', channel: 'telegram', chatRef: 'chat-1' }]];
    await expect(relayInsightCard(context(), CARD_ID)).rejects.toThrow('no valid evidence groups');
    expect(state.values).toEqual([]);
    expect(state.sent).toEqual([]);
  });
});
