import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockDbFactory, mockState } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({
  platformConnection: {}, fanvueWebhookEvent: {}, fanvueChurnRescue: {}, fanvueSubscriptionAttribution: {},
  shortLink: {}, linkbioAttributionEvent: {}, modelProfile: {},
}));
vi.mock('@axiom/worker', () => ({ connectorForConnection: vi.fn() }));

import { connectorForConnection } from '@axiom/worker';
import { fanvueLifecycleRouter } from './fanvue-lifecycle.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';
const RECIPIENT_ID = '44444444-4444-4444-8444-444444444444';
const SHORT_LINK_ID = '55555555-5555-4555-8555-555555555555';
const SECRET = 'fanvue-lifecycle-test-secret-0001';
const CREATOR_ID = '66666666-6666-4666-8666-666666666666';

function app() {
  const server = new Hono<AppBindings>();
  server.route('/', fanvueLifecycleRouter);
  return server;
}

function signedHeaders(body: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex');
  return { 'content-type': 'application/json', 'x-fanvue-signature': `t=${timestamp},v0=${signature}` };
}

const connection = { id: CONNECTION_ID, orgId: ORG_ID, modelId: MODEL_ID, platform: 'fanvue', status: 'connected' };

beforeEach(() => {
  mockState.result = [];
  mockState.results = [];
  mockState.insertValues = [];
  mockState.updates = [];
  mockState.conflictUpdates = [];
  vi.stubEnv('FANVUE_WEBHOOK_SECRET', SECRET);
  vi.mocked(connectorForConnection).mockReset().mockResolvedValue({ connector: { auth: { externalUserId: CREATOR_ID } } } as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('signed Fanvue lifecycle webhook', () => {
  it('creates one deduplicated operator rescue candidate for a deactivated subscription', async () => {
    const body = JSON.stringify({
      id: 'event-expired-1', type: 'creator.subscription.deactivated', timestamp: '2026-09-22T00:00:00Z',
      data: { id: null, status: 'expired', expires_at: '2026-09-22T00:00:00Z', deactivation_reason: 'not_renewed',
        creator: { uuid: CREATOR_ID }, purchaser: { uuid: RECIPIENT_ID, email: 'discard@example.test' } },
    });
    mockState.results = [[], [connection], [], [{ id: 'receipt-1' }], [{ id: 'rescue-1' }]];
    const response = await app().request(`/webhooks/fanvue/${ORG_ID}/${CONNECTION_ID}`, {
      method: 'POST', headers: signedHeaders(body), body,
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true, rescueCreated: true, attributionCreated: false });
    expect(mockState.insertValues[0]).toMatchObject({ providerEventId: 'event-expired-1', eventType: 'creator.subscription.deactivated' });
    expect(mockState.insertValues[1]).toMatchObject({
      orgId: ORG_ID, modelId: MODEL_ID, connectionId: CONNECTION_ID,
      subscriptionId: expect.stringMatching(/^cycle:[0-9a-f]{64}$/), recipientUuid: RECIPIENT_ID, status: 'ready',
    });
    expect(JSON.stringify(mockState.insertValues)).not.toContain('discard@example.test');
  });

  it('joins a signed successful payment to the exact stored UTM link', async () => {
    const body = JSON.stringify({
      id: 'event-payment-1', type: 'creator.payment.succeeded', timestamp: '2026-09-22T00:00:00Z',
      data: { id: 'payment-1', creator: { uuid: CREATOR_ID }, gross: 1900, currency: 'USD',
        subscription: { id: 'subscription-1' }, tracking: { link_url: 'https://fanvue.com/creator/other', metadata: { source: 'axiom', content: 'native-1' } } },
    });
    mockState.results = [
      [], [connection], [], [{ id: 'receipt-2' }],
      [{ shortLinkId: SHORT_LINK_ID, utm: { utm_source: 'axiom', utm_content: 'native-1' } }],
      [{ id: 'attribution-1' }],
    ];
    const response = await app().request(`/webhooks/fanvue/${ORG_ID}/${CONNECTION_ID}`, {
      method: 'POST', headers: signedHeaders(body), body,
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ attributionCreated: true });
    expect(mockState.insertValues[1]).toMatchObject({
      orgId: ORG_ID, modelId: MODEL_ID, shortLinkId: SHORT_LINK_ID, eventKey: 'payment:payment-1',
      kind: 'subscription', amountCents: 1900, currency: 'USD', utm: { utm_source: 'axiom', utm_content: 'native-1' },
      fanvueConnectionId: CONNECTION_ID, fanvueSubscriptionId: 'subscription-1',
    });
  });

  it('stores activation metadata and backfills a payment received first', async () => {
    const body = JSON.stringify({ id: 'event-activation-1', type: 'creator.subscription.activated', timestamp: '2026-09-22T00:00:00Z',
      data: { id: 'subscription-1', creator: { uuid: CREATOR_ID }, tracking: { metadata: { source: 'axiom', campaign: 'launch' } } },
    });
    mockState.results = [[], [connection], [], [{ id: 'receipt-activation' }],
      [{ id: SHORT_LINK_ID, utm: { utm_source: 'axiom', utm_campaign: 'launch' } }],
    ];
    const response = await app().request(`/webhooks/fanvue/${ORG_ID}/${CONNECTION_ID}`, {
      method: 'POST', headers: signedHeaders(body), body,
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ attributionCreated: true });
    expect(mockState.insertValues[1]).toMatchObject({
      orgId: ORG_ID, modelId: MODEL_ID, connectionId: CONNECTION_ID, subscriptionId: 'subscription-1',
      shortLinkId: SHORT_LINK_ID, utm: { utm_source: 'axiom', utm_campaign: 'launch' }, providerEventId: 'event-activation-1',
    });
    expect(mockState.conflictUpdates[0]).toMatchObject({
      set: { shortLinkId: SHORT_LINK_ID, utm: { utm_source: 'axiom', utm_campaign: 'launch' } },
    });
    expect(mockState.updates[0]).toMatchObject({ shortLinkId: SHORT_LINK_ID, utm: { utm_source: 'axiom', utm_campaign: 'launch' } });
  });

  it('accepts banned-user deactivations as receipts without creating a rescue target', async () => {
    const body = JSON.stringify({ id: 'event-banned-1', type: 'creator.subscription.deactivated', timestamp: '2026-09-22T00:00:00Z',
      data: { id: null, expires_at: '2026-09-22T00:00:00Z', deactivation_reason: 'user_banned',
        creator: { uuid: CREATOR_ID }, purchaser: { uuid: RECIPIENT_ID } },
    });
    mockState.results = [[], [connection], [], [{ id: 'receipt-banned' }]];
    const response = await app().request(`/webhooks/fanvue/${ORG_ID}/${CONNECTION_ID}`, {
      method: 'POST', headers: signedHeaders(body), body,
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true, rescueCreated: false });
    expect(mockState.insertValues.filter(value => (value as Record<string, unknown>).status === 'ready')).toHaveLength(0);
  });

  it('rejects unsigned events before touching the database', async () => {
    const response = await app().request(`/webhooks/fanvue/${ORG_ID}/${CONNECTION_ID}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'bad', type: 'unknown', data: {} }),
    });
    expect(response.status).toBe(401);
    expect(mockState.results).toEqual([]);
  });
});
