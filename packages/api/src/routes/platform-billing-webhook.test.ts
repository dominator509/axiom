import { createHmac } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';

const state = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./platform-affiliate.js', () => ({ platformAffiliateRouter: { request: state.request } }));

import { platformBillingWebhookRouter } from './platform-billing-webhook.js';

const secret = 'test-platform-billing-secret';
const event = {
  eventId: 'checkout-event-0001', kind: 'subscription_started', campaignId: '33333333-3333-4333-8333-333333333333',
  creatorUserId: 'creator-user-1', amountCents: 7900, occurredAt: '2026-09-23T12:00:00.000Z',
} as const;
const body = JSON.stringify(event);
function sign(raw: string, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${raw}`, 'utf8').digest('hex');
  return `t=${timestamp},v1=${digest}`;
}
function app() {
  const server = new Hono<AppBindings>();
  server.route('/', platformBillingWebhookRouter);
  return server;
}

beforeEach(() => {
  process.env.PLATFORM_BILLING_WEBHOOK_SECRET = secret;
  state.request.mockReset();
  state.request.mockResolvedValue(new Response(JSON.stringify({ data: { id: 'conversion-1' }, duplicate: false }), {
    status: 201, headers: { 'content-type': 'application/json' },
  }));
});

it('rejects invalid signatures before the conversion ledger is reached', async () => {
  const response = await app().request('/affiliate-billing/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-axiom-billing-signature': sign(body) }, body: `${body} `,
  });
  expect(response.status).toBe(401);
  expect(state.request).not.toHaveBeenCalled();
});

it('maps a verified event to the existing idempotent conversion ledger and returns its durable result', async () => {
  const response = await app().request('/affiliate-billing/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-axiom-billing-signature': sign(body) }, body,
  });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ data: { id: 'conversion-1' }, duplicate: false });
  expect(state.request).toHaveBeenCalledTimes(1);
  const forwarded = state.request.mock.calls[0][0] as Request;
  expect(await forwarded.json()).toEqual({
    campaignId: event.campaignId,
    kind: event.kind,
    amountCents: event.amountCents,
    billingEventKey: 'billing:checkout-event-0001',
    creatorUserId: event.creatorUserId,
    occurredAt: event.occurredAt,
  });
  expect(forwarded.headers.get('idempotency-key')).toBe('billing:checkout-event-0001');
});
