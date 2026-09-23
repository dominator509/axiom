import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fanvueDeactivatedSubscription, fanvueSubscriptionAttribution, fanvueSuccessfulPayment, parseFanvueWebhook, verifyFanvueWebhookSignature } from './fanvue-webhook-contract.js';

const secret = 'fixture-fanvue-webhook-secret-0001';
const now = Date.parse('2026-09-23T12:00:00Z');
const sign = (body: string, timestamp = Math.floor(now / 1000)) =>
  `t=${timestamp},v0=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

describe('Fanvue webhook contracts', () => {
  it('verifies exact-body timestamped signatures and rejects stale or altered requests', () => {
    const body = JSON.stringify({ id: 'event-1', type: 'ignored', data: {} });
    expect(verifyFanvueWebhookSignature(body, sign(body), secret, now)).toBe(true);
    expect(verifyFanvueWebhookSignature(`${body} `, sign(body), secret, now)).toBe(false);
    expect(verifyFanvueWebhookSignature(body, sign(body, Math.floor(now / 1000) - 301), secret, now)).toBe(false);
    expect(verifyFanvueWebhookSignature(body, sign(body), undefined, now)).toBe(false);
  });

  it('extracts an expired subscription without retaining purchaser profile fields', () => {
    const event = parseFanvueWebhook(JSON.stringify({
      id: 'evt-expired', type: 'creator.subscription.deactivated', timestamp: '2026-09-22T00:00:00Z',
      data: {
        object: 'subscription', id: null, status: 'expired', expires_at: '2026-09-22T00:00:00Z', deactivation_reason: 'not_renewed',
        creator: { uuid: '11111111-1111-4111-8111-111111111111' },
        purchaser: { uuid: '22222222-2222-4222-8222-222222222222', email: 'must-not-persist@example.test' },
      },
    }));
    expect(event).not.toBeNull();
    expect(fanvueDeactivatedSubscription(event!)).toEqual({
      creatorUuid: '11111111-1111-4111-8111-111111111111',
      recipientUuid: '22222222-2222-4222-8222-222222222222',
      subscriptionId: expect.stringMatching(/^cycle:[0-9a-f]{64}$/),
      eligible: true,
    });
    expect(event!.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('maps only valid Fanvue payment facts and bounded UTM values', () => {
    const event = parseFanvueWebhook(JSON.stringify({ id: 'evt-payment', type: 'creator.payment.succeeded', timestamp: now, data: {
      id: 'payment-1', gross: 1250, currency: 'USD', creator: { uuid: '11111111-1111-4111-8111-111111111111' },
      subscription: { id: 'sub-1' },
      tracking: { link_url: 'https://fanvue.com/creator/last-touch', metadata: { source: 'axiom', content: 'native-1', private_note: 'discarded' } },
    } }));
    expect(fanvueSuccessfulPayment(event!)).toEqual({
      paymentId: 'payment-1', kind: 'subscription', amountCents: 1250, currency: 'USD',
      utm: { utm_source: 'axiom', utm_content: 'native-1' }, subscriptionId: 'sub-1',
      creatorUuid: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('captures creator-scoped subscription metadata for the later payment join', () => {
    const event = parseFanvueWebhook(JSON.stringify({ id: 'evt-sub', type: 'creator.subscription.activated', timestamp: now, data: {
      id: 'sub-1', creator: { uuid: '11111111-1111-4111-8111-111111111111' },
      tracking: { link_url: 'https://fanvue.com/creator/last-touch', metadata: { campaign: 'launch', source: 'axiom', email: 'discarded' } },
    } }));
    expect(fanvueSubscriptionAttribution(event!)).toEqual({
      creatorUuid: '11111111-1111-4111-8111-111111111111', subscriptionId: 'sub-1',
      utm: { utm_source: 'axiom', utm_campaign: 'launch' },
    });
  });

  it('records ineligible deactivations without creating a rescue target', () => {
    const event = parseFanvueWebhook(JSON.stringify({ id: 'evt-banned', type: 'creator.subscription.deactivated', timestamp: now, data: {
      id: null, expires_at: '2026-09-22T00:00:00Z', deactivation_reason: 'user_banned',
      creator: { uuid: '11111111-1111-4111-8111-111111111111' },
      purchaser: { uuid: '22222222-2222-4222-8222-222222222222' },
    } }));
    expect(fanvueDeactivatedSubscription(event!)).toMatchObject({ eligible: false, recipientUuid: '22222222-2222-4222-8222-222222222222' });
  });

  it('uses the provider timestamp and rejects events without a provider time', () => {
    const timestamp = parseFanvueWebhook(JSON.stringify({ id: 'evt-time', type: 'unknown', timestamp: '2026-09-20T08:30:00Z', data: {} }));
    expect(timestamp?.occurredAt.toISOString()).toBe('2026-09-20T08:30:00.000Z');
    expect(parseFanvueWebhook(JSON.stringify({ id: 'evt-no-time', type: 'unknown', data: {} }))).toBeNull();
  });
});
