import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { parsePlatformBillingEvent, verifyPlatformBillingSignature } from './platform-billing-webhook-contract.js';

const SECRET = 'isolated-platform-billing-secret';
const now = 1_800_000_000_000;
const body = JSON.stringify({
  eventId: 'invoice-event-0001', kind: 'subscription_started',
  campaignId: '11111111-1111-4111-8111-111111111111', creatorUserId: 'creator-1', amountCents: 7900,
});
function signature(timestamp = Math.floor(now / 1000), payload = body) {
  const digest = createHmac('sha256', SECRET).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

it('accepts a fresh HMAC signature and rejects body, key, and timestamp changes', () => {
  expect(verifyPlatformBillingSignature(body, signature(), SECRET, now)).toBe(true);
  expect(verifyPlatformBillingSignature(`${body} `, signature(), SECRET, now)).toBe(false);
  expect(verifyPlatformBillingSignature(body, signature(), `${SECRET}-wrong`, now)).toBe(false);
  expect(verifyPlatformBillingSignature(body, signature(1), SECRET, now)).toBe(false);
});

it('normalizes only bounded started/renewed/refund events and requires a refund source', () => {
  expect(parsePlatformBillingEvent(JSON.parse(body))).toMatchObject({ eventId: 'invoice-event-0001', amountCents: 7900 });
  expect(parsePlatformBillingEvent({ eventId: 'refund-0001', kind: 'subscription_refunded',
    campaignId: '11111111-1111-4111-8111-111111111111', creatorUserId: 'creator-1', amountCents: 7900 })).toBeNull();
  expect(parsePlatformBillingEvent({ ...JSON.parse(body), secret: 'must-not-be-accepted' })).toBeNull();
});
