// ─── Patreon Community Connector tests (F-91, L3.2 §3a) ───
//
// Every test is hermetic: the transport is injected, so no provider, network,
// credential or live OAuth is contacted or claimed.

import { describe, expect, it, vi } from 'vitest';
import {
  PatreonCommunityConnector,
  PATREON_DENIED_ACTIONS,
  CAMPAIGN_FIELDS,
  MEMBER_FIELDS,
  POST_FIELDS,
  createMemoryLedger,
  timingSafeEqual,
  type PatreonTransport,
} from './patreon.js';

const ACCESS_TOKEN = 'test-access-token-not-a-secret';
const WEBHOOK_SECRET = 'test-webhook-secret-value-0001';

function makeTransport(
  responses: Array<{ status: number; body?: unknown }>,
): { transport: PatreonTransport; calls: string[]; bodies: unknown[] } {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  let index = 0;
  const next = () => {
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return response;
  };
  return {
    calls,
    bodies,
    transport: {
      async getJson(url: string) {
        calls.push(url);
        const r = next();
        return { status: r.status, body: r.body ?? {} };
      },
      async postJson(url: string, body: unknown) {
        calls.push(url);
        bodies.push(body);
        const r = next();
        return { status: r.status, body: r.body ?? {} };
      },
      async delete(url: string) {
        calls.push(url);
        const r = next();
        return { status: r.status };
      },
    },
  };
}

function makeConnector(
  transport: PatreonTransport,
  overrides: Partial<ConstructorParameters<typeof PatreonCommunityConnector>[0]> = {},
) {
  return new PatreonCommunityConnector({
    auth: { accessToken: ACCESS_TOKEN, externalUserId: 'creator-1' },
    transport,
    ledger: createMemoryLedger(),
    webhookSecret: WEBHOOK_SECRET,
    ...overrides,
  });
}

const CAMPAIGN_RESPONSE = {
  status: 200,
  body: {
    data: {
      id: 'camp-123',
      type: 'campaign',
      attributes: {
        creation_name: 'Studio North',
        patron_count: 42,
        created_at: '2024-01-01T00:00:00Z',
        published_at: '2024-02-01T00:00:00Z',
        vanity: 'studionorth',
      },
    },
  },
};

describe('patreon capability honesty', () => {
  it('declares the read/sync/event contract and publish none', () => {
    const { transport } = makeTransport([]);
    const connector = makeConnector(transport);
    const cap = connector.capability();
    expect(cap).toEqual({
      identity: true,
      campaigns: true,
      memberships: true,
      postsRead: true,
      webhooks: true,
      publish: 'none',
    });
    expect(cap.publish).not.toBe('assisted');
  });

  it('rejects every denied action and returns truthful manual-assist', () => {
    const { transport } = makeTransport([]);
    const connector = makeConnector(transport);
    for (const action of PATREON_DENIED_ACTIONS) {
      expect(connector.supports(action)).toBe(false);
      const assist = connector.manualAssist(action);
      expect(assist.supported).toBe(false);
      expect(assist.manualAssist).toBe(true);
      expect(assist.action).toBe(action);
      expect(assist.reason.length).toBeGreaterThan(0);
    }
  });

  it('never claims an analytics revenue capability', () => {
    const { transport } = makeTransport([]);
    const connector = makeConnector(transport);
    const cap = connector.capability();
    expect(Object.keys(cap)).not.toContain('metrics');
    expect(Object.keys(cap)).not.toContain('analytics');
    expect(connector.supports('analytics_revenue')).toBe(false);
  });
});

describe('patreon OAuth binding and expiry', () => {
  it('refuses construction without an access token', () => {
    const { transport } = makeTransport([]);
    expect(
      () => new PatreonCommunityConnector({ auth: { accessToken: '' }, transport, ledger: createMemoryLedger(), webhookSecret: WEBHOOK_SECRET }),
    ).toThrow(/missing access token/);
  });

  it('refuses a weak webhook secret', () => {
    const { transport } = makeTransport([]);
    expect(
      () => new PatreonCommunityConnector({ auth: { accessToken: ACCESS_TOKEN }, transport, ledger: createMemoryLedger(), webhookSecret: 'short' }),
    ).toThrow(/at least 16 characters/);
  });

  it('preserves token expiry from the binding', () => {
    const { transport } = makeTransport([]);
    const expiresAt = 1_900_000_000;
    const connector = makeConnector(transport, {
      auth: { accessToken: ACCESS_TOKEN, refreshToken: 'refresh-1', expiresAt },
    });
    expect(connector.auth.expiresAt).toBe(expiresAt);
    expect(connector.auth.refreshToken).toBe('refresh-1');
  });

  it('revokes access and clears the local campaign binding', async () => {
    const { transport, calls } = makeTransport([CAMPAIGN_RESPONSE, { status: 204 }]);
    const connector = makeConnector(transport);
    await connector.syncCampaign();
    await connector.revoke();
    expect(calls[calls.length - 1]).toContain('/oauth2/token');
    await expect(connector.syncMembers()).rejects.toThrow(/syncCampaign\(\)/);
  });
});

describe('patreon campaign identity', () => {
  it('requests explicit campaign fields and normalizes identity', async () => {
    const { transport, calls } = makeTransport([CAMPAIGN_RESPONSE]);
    const connector = makeConnector(transport);
    const campaign = await connector.syncCampaign();
    expect(campaign.providerCampaignId).toBe('camp-123');
    expect(campaign.creatorProviderId).toBe('creator-1');
    expect(campaign.name).toBe('Studio North');
    expect(campaign.patronCount).toBe(42);
    expect(calls[0]).toContain('fields%5Bcampaign%5D=');
    for (const field of CAMPAIGN_FIELDS) {
      expect(decodeURIComponent(calls[0])).toContain(field);
    }
  });

  it('fails loud when the campaign payload lacks an id', async () => {
    const { transport } = makeTransport([{ status: 200, body: { data: { attributes: {} } } }]);
    const connector = makeConnector(transport);
    await expect(connector.syncCampaign()).rejects.toThrow(/missing campaign id/);
  });

  it('fails loud when no creator identity is available', async () => {
    const { transport } = makeTransport([CAMPAIGN_RESPONSE]);
    const connector = makeConnector(transport, { auth: { accessToken: ACCESS_TOKEN } });
    await expect(connector.syncCampaign()).rejects.toThrow(/missing creator id/);
  });

  it('fails loud on a non-200 campaign response', async () => {
    const { transport } = makeTransport([{ status: 401 }]);
    const connector = makeConnector(transport);
    await expect(connector.syncCampaign()).rejects.toThrow(/status 401/);
  });
});

describe('patreon membership and tier sync', () => {
  const membersResponse = {
    status: 200,
    body: {
      data: [
        {
          id: 'member-1',
          type: 'member',
          attributes: {
            full_name: 'A Patron',
            patron_status: 'active_patron',
            currently_entitled_amount_cents: 500,
            last_charge_status: 'Paid',
          },
          relationships: { currently_entitled_tiers: { data: [{ id: 'tier-9', type: 'tier' }] } },
        },
        {
          id: 'member-2',
          type: 'member',
          attributes: { patron_status: 'former_patron' },
          relationships: { currently_entitled_tiers: { data: [] } },
        },
      ],
      included: [{ id: 'tier-9', type: 'tier', attributes: { title: 'Gold' } }],
      meta: { pagination: { cursors: { next: 'CURSOR-M1' } } },
    },
  };

  it('maps memberships and resolves included tier titles', async () => {
    const { transport, calls } = makeTransport([CAMPAIGN_RESPONSE, membersResponse]);
    const connector = makeConnector(transport);
    await connector.syncCampaign();
    const page = await connector.syncMembers();
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({
      providerMemberId: 'member-1',
      providerCampaignId: 'camp-123',
      tierId: 'tier-9',
      tierTitle: 'Gold',
      status: 'active_patron',
      currentlyEntitledAmountCents: 500,
    });
    expect(page.items[1].tierId).toBeUndefined();
    expect(page.nextCursor).toBe('CURSOR-M1');
    expect(calls[1]).toContain(encodeURIComponent('fields[member]'));
    for (const field of MEMBER_FIELDS) {
      expect(decodeURIComponent(calls[1])).toContain(field);
    }
  });

  it('rejects a replayed membership cursor', async () => {
    const { transport } = makeTransport([CAMPAIGN_RESPONSE, membersResponse, membersResponse]);
    const connector = makeConnector(transport);
    await connector.syncCampaign();
    await connector.syncMembers('CURSOR-M1');
    await expect(connector.syncMembers('CURSOR-M1')).rejects.toThrow(/duplicate membership cursor/);
  });

  it('allows distinct cursors to proceed', async () => {
    const { transport } = makeTransport([CAMPAIGN_RESPONSE, membersResponse, membersResponse]);
    const connector = makeConnector(transport);
    await connector.syncCampaign();
    await connector.syncMembers('CURSOR-M1');
    await expect(connector.syncMembers('CURSOR-M2')).resolves.toBeDefined();
  });
});

describe('patreon post reads', () => {
  const postsResponse = {
    status: 200,
    body: {
      data: [
        {
          id: 'post-1',
          type: 'post',
          attributes: { title: 'Early access', is_public: false, published_at: '2024-03-01T00:00:00Z', url: 'https://patreon.com/p/1' },
        },
      ],
      meta: { pagination: { cursors: { next: 'CURSOR-P1' } } },
    },
  };

  it('maps posts, honors explicit fields and returns the cursor', async () => {
    const { transport, calls } = makeTransport([CAMPAIGN_RESPONSE, postsResponse]);
    const connector = makeConnector(transport);
    await connector.syncCampaign();
    const page = await connector.syncPosts();
    expect(page.items[0]).toMatchObject({
      providerPostId: 'post-1',
      providerCampaignId: 'camp-123',
      title: 'Early access',
      isPublic: false,
    });
    expect(page.nextCursor).toBe('CURSOR-P1');
    for (const field of POST_FIELDS) {
      expect(decodeURIComponent(calls[1])).toContain(field);
    }
  });

  it('rejects a replayed post cursor', async () => {
    const { transport } = makeTransport([CAMPAIGN_RESPONSE, postsResponse, postsResponse]);
    const connector = makeConnector(transport);
    await connector.syncCampaign();
    await connector.syncPosts('CURSOR-P1');
    await expect(connector.syncPosts('CURSOR-P1')).rejects.toThrow(/duplicate post cursor/);
  });
});

describe('patreon webhook signature and replay protection', () => {
  async function signedBody(body: unknown, secret = WEBHOOK_SECRET): Promise<{ raw: string; sig: string }> {
    const raw = JSON.stringify(body);
    const { createHmac } = await import('node:crypto');
    const sig = createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
    return { raw, sig };
  }

  const event = { data: { id: 'evt-1', type: 'members:pledge:create' } };

  it('accepts a correctly signed event', async () => {
    const { transport } = makeTransport([]);
    const onEvent = vi.fn();
    const connector = makeConnector(transport, { onEvent });
    const { raw, sig } = await signedBody(event);
    const result = await connector.handleWebhook(raw, sig);
    expect(result.ok).toBe(true);
    expect(result.event?.eventId).toBe('evt-1');
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('rejects a wrong signature without invoking the handler', async () => {
    const { transport } = makeTransport([]);
    const onEvent = vi.fn();
    const connector = makeConnector(transport, { onEvent });
    const { raw } = await signedBody(event);
    const result = await connector.handleWebhook(raw, 'deadbeef');
    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('rejects a signature made with the wrong secret', async () => {
    const { transport } = makeTransport([]);
    const connector = makeConnector(transport);
    const { raw, sig } = await signedBody(event, 'attacker-secret-value-xxxx');
    const result = await connector.handleWebhook(raw, sig);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature_mismatch');
  });

  it('rejects a replayed event id', async () => {
    const { transport } = makeTransport([]);
    const onEvent = vi.fn();
    const connector = makeConnector(transport, { onEvent });
    const { raw, sig } = await signedBody(event);
    await connector.handleWebhook(raw, sig);
    const replay = await connector.handleWebhook(raw, sig);
    expect(replay).toEqual({ ok: false, reason: 'replay_rejected' });
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed JSON after a valid signature', async () => {
    const { transport } = makeTransport([]);
    const connector = makeConnector(transport);
    const raw = '{not-json';
    const { createHmac } = await import('node:crypto');
    const sig = createHmac('sha256', WEBHOOK_SECRET).update(raw, 'utf8').digest('hex');
    const result = await connector.handleWebhook(raw, sig);
    expect(result).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('rejects an event with no id', async () => {
    const { transport } = makeTransport([]);
    const connector = makeConnector(transport);
    const { raw, sig } = await signedBody({ data: { type: 'members:pledge:create' } });
    const result = await connector.handleWebhook(raw, sig);
    expect(result).toEqual({ ok: false, reason: 'missing_event_id' });
  });

  it('never returns the webhook secret on any surface', async () => {
    const { transport } = makeTransport([]);
    const connector = makeConnector(transport);
    expect(JSON.stringify(connector.capability())).not.toContain(WEBHOOK_SECRET);
    await connector.ensureWebhooks().catch(() => undefined);
    expect(Object.keys(connector.manualAssist('publish'))).not.toContain('webhookSecret');
  });
});

describe('patreon webhook registration', () => {
  it('registers triggers and keeps the secret out of the response', async () => {
    const { transport, bodies } = makeTransport([CAMPAIGN_RESPONSE, { status: 201 }]);
    const connector = makeConnector(transport);
    await connector.syncCampaign();
    const result = await connector.ensureWebhooks();
    expect(result.registered).toBe(true);
    const sent = JSON.stringify(bodies[0]);
    expect(sent).toContain('members:pledge:create');
    expect(sent).toContain('posts:publish');
    expect(sent).not.toContain(WEBHOOK_SECRET);
  });
});

describe('patreon constant-time comparison', () => {
  it('matches equal strings and rejects differing lengths or bytes', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('patreon cross-tenant isolation', () => {
  it('keeps separate connectors and ledgers independent', async () => {
    const a = makeTransport([CAMPAIGN_RESPONSE, { status: 200, body: { data: [], meta: {} } }]);
    const b = makeTransport([CAMPAIGN_RESPONSE, { status: 200, body: { data: [], meta: {} } }]);
    const ca = makeConnector(a.transport);
    const cb = makeConnector(b.transport);
    await ca.syncCampaign();
    await cb.syncCampaign();
    await ca.syncMembers('SHARED-CURSOR');
    // The same opaque cursor in a different tenant ledger is not a duplicate.
    await expect(cb.syncMembers('SHARED-CURSOR')).resolves.toBeDefined();
  });
});
