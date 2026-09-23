// Signed, provider-neutral billing ingress for the platform-owned F-90 ledger.
// Billing vendors must map their webhook into this narrow normalized contract.
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { rateLimit } from '../contract.js';
import { readBoundedText, RequestBodyTooLargeError } from '../webhook-body.js';
import { parsePlatformBillingEvent, verifyPlatformBillingSignature } from '../platform-billing-webhook-contract.js';
import { platformAffiliateRouter } from './platform-affiliate.js';
import { apiError, statusTitle } from './helpers.js';

const router = new Hono<AppBindings>();
router.use('/affiliate-billing/webhook', rateLimit({ capacity: 120, refillPerSec: 2, maxBuckets: 100_000 }));

router.post('/affiliate-billing/webhook', async c => {
  let raw: string;
  try { raw = await readBoundedText(c.req.raw, 65_536); }
  catch (error) {
    if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'billing event body too large');
    return apiError(c, 400, statusTitle(400), 'billing event body could not be read');
  }
  const secret = process.env.PLATFORM_BILLING_WEBHOOK_SECRET;
  if (!secret || !verifyPlatformBillingSignature(raw, c.req.header('x-axiom-billing-signature') ?? null, secret)) {
    return apiError(c, 401, statusTitle(401), 'billing event signature is invalid or stale');
  }
  let payload: unknown;
  try { payload = JSON.parse(raw); }
  catch { return apiError(c, 400, statusTitle(400), 'billing event JSON is invalid'); }
  const event = parsePlatformBillingEvent(payload);
  if (!event) return apiError(c, 400, statusTitle(400), 'billing event does not match the normalized contract');

  const request = new Request('http://affiliate-internal/conversions/reconcile', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `billing:${event.eventId}` },
    body: JSON.stringify({
      campaignId: event.campaignId,
      kind: event.kind,
      amountCents: event.amountCents,
      billingEventKey: `billing:${event.eventId}`,
      creatorUserId: event.creatorUserId,
      ...(event.sourceEventId ? { sourceBillingEventKey: `billing:${event.sourceEventId}` } : {}),
      ...(event.occurredAt ? { occurredAt: event.occurredAt } : {}),
    }),
  });
  const reconciled = await platformAffiliateRouter.request(request);
  const responseBody = await reconciled.json().catch(() => ({ error: { message: 'billing reconciliation failed' } }));
  return c.json(responseBody, reconciled.status as 200);
});

export { router as platformBillingWebhookRouter };
