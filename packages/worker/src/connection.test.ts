import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  binding: { mode: 'model-egress' } as unknown,
  filters: [] as Array<{ field: unknown; value: unknown }>,
  egressFetch: vi.fn(),
}));

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    and: vi.fn((...conditions: unknown[]) => ({ conditions })),
    eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
    inArray: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  };
});

vi.mock('@axiom/llm-gateway', () => ({
  buildEgressFetch: vi.fn(() => state.egressFetch),
  resolveEgressBinding: vi.fn(async () => state.binding),
}));

import { asPlatform, parseConnectorAuth, telegramRelayTransportForTarget } from './connection.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';

function telegramConnection(id: string, modelId = MODEL_ID, orgId = ORG_ID) {
  return {
    id,
    orgId,
    modelId,
    platform: 'telegram',
    status: 'connected',
    connectedAt: new Date('2026-01-01T00:00:00.000Z'),
    encToken: new Uint8Array([1]),
    encNonce: new Uint8Array([2]),
    dekId: `dek-${id}`,
  };
}

function connectionTx(rows: unknown[]) {
  const query = {
    select: () => query,
    from: () => query,
    where: (condition: { conditions: Array<{ field: unknown; value: unknown }> }) => {
      state.filters = condition.conditions;
      return query;
    },
    orderBy: async () => rows,
  };
  return query;
}

function decryptedCredentials(accessToken: string, extra: Record<string, unknown>) {
  return new Response(JSON.stringify({
    plaintext: Buffer.from(JSON.stringify({ accessToken, externalUserId: '-1001234567890', extra })).toString('base64'),
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('telegramRelayTransportForTarget', () => {
  afterEach(() => vi.clearAllMocks());

  it('resolves only the active org/model destination and returns model egress transport', async () => {
    state.binding = { mode: 'model-egress' };
    state.egressFetch = vi.fn();
    const fetchMock = vi.fn(async () => decryptedCredentials('synthetic-encrypted-bot-token', {
      telegramChatId: '-1001234567890',
      telegramChannelUsername: '@creator_channel',
      telegramInputRef: '@creator_channel',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const transport = await telegramRelayTransportForTarget(
      connectionTx([telegramConnection('connection-1')]), ORG_ID, MODEL_ID, '@CREATOR_CHANNEL',
    );

    expect(transport).toEqual({ token: 'synthetic-encrypted-bot-token', fetch: state.egressFetch });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.filters.map(({ value }) => value)).toEqual([
      ORG_ID,
      MODEL_ID,
      'telegram',
      ['connected', 'active'],
    ]);
  });

  it('supports canonical numeric destination IDs stored in encrypted credentials', async () => {
    state.binding = { mode: 'model-egress' };
    state.egressFetch = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => decryptedCredentials('synthetic-bot-token', {})));

    await expect(telegramRelayTransportForTarget(
      connectionTx([telegramConnection('connection-1')]), ORG_ID, MODEL_ID, '-1001234567890',
    )).resolves.toMatchObject({ token: 'synthetic-bot-token' });
  });

  it('fails closed when there is no matching destination or when matches are ambiguous', async () => {
    const fetchMock = vi.fn(async () => decryptedCredentials('synthetic-bot-token', {
      telegramChannelUsername: '@another_channel',
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(telegramRelayTransportForTarget(
      connectionTx([telegramConnection('connection-1')]), ORG_ID, MODEL_ID, '@creator_channel',
    )).rejects.toThrow('no active Telegram connection matches');
    expect(state.egressFetch).not.toHaveBeenCalled();

    fetchMock.mockImplementation(async () => decryptedCredentials('synthetic-bot-token', {
      telegramChannelUsername: '@creator_channel',
    }));
    await expect(telegramRelayTransportForTarget(
      connectionTx([telegramConnection('connection-1'), telegramConnection('connection-2')]), ORG_ID, MODEL_ID, '@creator_channel',
    )).rejects.toThrow('multiple active Telegram connections match');
    expect(state.egressFetch).not.toHaveBeenCalled();
  });

  it('does not fall back to direct Telegram traffic when model egress is unavailable', async () => {
    state.binding = null;
    vi.stubGlobal('fetch', vi.fn(async () => decryptedCredentials('synthetic-bot-token', {})));

    await expect(telegramRelayTransportForTarget(
      connectionTx([telegramConnection('connection-1')]), ORG_ID, MODEL_ID, '-1001234567890',
    )).rejects.toThrow('no healthy egress binding');
  });
});

describe('parseConnectorAuth', () => {
  it('accepts a legacy raw access-token envelope', () => {
    expect(parseConnectorAuth('raw-access-token')).toEqual({ accessToken: 'raw-access-token' });
  });

  it('accepts the JSON connector-auth envelope and normalizes OAuth field names', () => {
    expect(
      parseConnectorAuth(
        JSON.stringify({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          external_user_id: 'provider-user',
          expires_at: 1_800_000_000,
          extra: { pageId: 'page-1' },
        }),
      ),
    ).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      externalUserId: 'provider-user',
      expiresAt: 1_800_000_000,
      extra: { pageId: 'page-1' },
    });
  });

  it('rejects structured credentials without an access token', () => {
    expect(() => parseConnectorAuth(JSON.stringify({ externalUserId: 'provider-user' }))).toThrow(
      'stored connector credential has no access token',
    );
  });

  it('accepts an empty access token only for explicitly marked Snapchat manual assist', () => {
    expect(parseConnectorAuth(JSON.stringify({ accessToken: '', extra: { snapchatManualAssist: true, snapchatProfileUrl: 'https://www.snapchat.com/add/creator' } }))).toEqual({
      accessToken: '',
      extra: { snapchatManualAssist: true, snapchatProfileUrl: 'https://www.snapchat.com/add/creator' },
    });
    expect(() => parseConnectorAuth(JSON.stringify({ accessToken: '', extra: { snapchatProfileUrl: 'https://www.snapchat.com/add/creator' } }))).toThrow('no access token');
  });

  it('rejects empty credentials', () => {
    expect(() => parseConnectorAuth('   ')).toThrow('stored connector credential is empty');
  });
});

describe('asPlatform', () => {
  it('accepts only the supported connector platforms', () => {
    expect(asPlatform('threads')).toBe('threads');
    expect(() => asPlatform('not-a-platform')).toThrow("unsupported target platform 'not-a-platform'");
  });
});
