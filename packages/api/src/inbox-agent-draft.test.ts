import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDbFactory, mockState } from './routes/test-utils.js';

const chat = vi.hoisted(() => vi.fn());
vi.mock('@axiom/db', () => mockDbFactory());
vi.mock('./roleplay-runtime.js', () => ({
  ROLEPLAY_PROVIDER_MODEL: 'grok-roleplayer',
  roleplayGateway: { chat },
}));
vi.mock('./routes/helpers.js', async (original) => ({
  ...(await original<typeof import('./routes/helpers.js')>()),
  writeAudit: vi.fn(),
}));

import { generateAssignedLlmDraft } from './inbox-agent-draft.js';

const orgId = '11111111-1111-4111-8111-111111111111';
const modelId = '22222222-2222-4222-8222-222222222222';
const connectionId = '33333333-3333-4333-8333-333333333333';
const counterpartUuid = '44444444-4444-4444-8444-444444444444';
const intentKey = '55555555-5555-4555-8555-555555555555';
const shiftId = '66666666-6666-4666-8666-666666666666';
const turnId = '77777777-7777-4777-8777-777777777777';
const replyId = '88888888-8888-4888-8888-888888888888';
const actorRef = 'grok-roleplayer';
const prompt = 'Write a warm, concise reply to the fan.';

const handoff = {
  currentOwner: { type: 'llm', ref: actorRef },
  actor: { type: 'llm', ref: actorRef },
  orgId,
  modelId,
  shiftId,
  queue: 'chatter',
  conversationCursor: null,
  lastSafeSummary: 'Keep the reply bounded and private.',
  pendingIntentId: null,
  memoryPolicy: { maxTurns: 20, maxCharacters: 8_000 },
  personaSource: null,
  allowedNextAction: 'Draft one private reply',
  terminal: false,
  unresolvedUncertainty: null,
  evidenceReferences: [],
};

const request = {
  orgId,
  userId: 'operator-1',
  role: 'operator',
  modelId,
  connectionId,
  counterpartUuid,
  intentKey,
  conversationKey: 'default',
  actorRef,
  prompt,
};

function initialResults(existing: unknown = []): unknown[] {
  return [
    [],
    [{ id: modelId }],
    [{ id: shiftId }],
    [{ id: 'permission-1' }],
    [{ id: connectionId }],
    existing,
    [{ payload: handoff }],
    [],
    [],
    [],
    [
      {
        id: turnId,
        state: 'pending',
        actorType: 'llm',
        actorRef,
        input: prompt,
        conversationKey: 'default',
      },
    ],
  ];
}

beforeEach(() => {
  mockState.results = [];
  mockState.result = [];
  mockState.insertValues = [];
  mockState.updates = [];
  chat.mockReset();
});

describe('assigned LLM inbox drafts', () => {
  it('uses the assigned roleplay context and persists one unapproved pending reply after a bounded provider result', async () => {
    mockState.results = [
      ...initialResults(),
      [],
      [{ id: turnId, state: 'pending', output: null }],
      [{ id: turnId, state: 'completed', output: 'Warm reply.', providerRequestId: 'provider-1' }],
      [],
      [
        {
          id: replyId,
          orgId,
          modelId,
          connectionId,
          counterpartUuid,
          intentKey,
          actorUserId: 'operator-1',
          body: 'Warm reply.',
          draftSource: 'llm',
          draftActorRef: actorRef,
          roleplayTurnId: turnId,
          approvedByUserId: null,
          approvedAt: null,
          state: 'pending',
        },
      ],
    ];
    chat.mockResolvedValue({
      id: 'provider-1',
      content: 'Warm reply.',
      model: 'grok-roleplayer',
      provider: 'grok',
      cost: 0,
      tokens: { prompt: 20, completion: 4, total: 24 },
      latency: 5,
      cached: false,
    });

    const result = await generateAssignedLlmDraft(request);
    expect(result).toEqual({
      outcome: 'created',
      record: expect.objectContaining({ id: replyId, draftSource: 'llm', approvedByUserId: null }),
    });
    expect(chat).toHaveBeenCalledOnce();
    expect(chat.mock.calls[0][0][0].content).toContain('Keep the reply bounded and private.');
    expect(chat.mock.calls[0][0][1]).toEqual({ role: 'user', content: prompt });
    expect(mockState.insertValues).toContainEqual(
      expect.objectContaining({
        draftSource: 'llm',
        draftActorRef: actorRef,
        roleplayTurnId: turnId,
        state: 'pending',
      }),
    );
  });

  it('returns the existing exact draft without calling the provider again', async () => {
    const existing = {
      id: replyId,
      orgId,
      modelId,
      connectionId,
      counterpartUuid,
      intentKey,
      actorUserId: 'operator-1',
      body: 'Warm reply.',
      draftSource: 'llm',
      draftActorRef: actorRef,
      roleplayTurnId: turnId,
      state: 'pending',
    };
    mockState.results = [
      [],
      [{ id: modelId }],
      [{ id: shiftId }],
      [{ id: 'permission-1' }],
      [{ id: connectionId }],
      [existing],
      [{ id: turnId, input: prompt, conversationKey: 'default' }],
    ];

    const result = await generateAssignedLlmDraft(request);
    expect(result).toEqual({ outcome: 'existing', record: existing });
    expect(chat).not.toHaveBeenCalled();
  });

  it('rejects an intent key reused for a different Fanvue connection or counterpart', async () => {
    const existing = {
      id: replyId,
      orgId,
      modelId,
      connectionId,
      counterpartUuid,
      intentKey,
      actorUserId: 'operator-1',
      body: 'Warm reply.',
      draftSource: 'llm',
      draftActorRef: actorRef,
      roleplayTurnId: turnId,
      state: 'pending',
    };
    mockState.results = [
      [],
      [{ id: modelId }],
      [{ id: shiftId }],
      [{ id: 'permission-1' }],
      [{ id: connectionId }],
      [existing],
      [{ id: turnId, input: prompt, conversationKey: 'default' }],
    ];

    const result = await generateAssignedLlmDraft({
      ...request,
      counterpartUuid: '99999999-9999-4999-8999-999999999999',
    });
    expect(result).toEqual({ outcome: 'conflict' });
    expect(chat).not.toHaveBeenCalled();
  });

  it('does not create a sendable reply when the provider outcome is uncertain', async () => {
    mockState.results = initialResults();
    chat.mockRejectedValue(new Error('provider unavailable'));

    const result = await generateAssignedLlmDraft(request);
    expect(result).toEqual({ outcome: 'uncertain' });
    expect(
      mockState.insertValues.some(
        (value) => typeof value === 'object' && value !== null && 'draftSource' in value,
      ),
    ).toBe(false);
  });

  it('rejects a missing active LLM shift before contacting the provider', async () => {
    mockState.results = [[], [{ id: modelId }], []];

    const result = await generateAssignedLlmDraft(request);
    expect(result).toEqual({ outcome: 'unavailable' });
    expect(chat).not.toHaveBeenCalled();
  });
});
