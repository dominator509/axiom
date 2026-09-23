import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const billingEventSchema = z.object({
  eventId: z.string().trim().min(8).max(200),
  kind: z.enum(['subscription_started', 'subscription_renewed', 'subscription_refunded']),
  campaignId: z.string().uuid(),
  creatorUserId: z.string().trim().min(1).max(255),
  amountCents: z.number().int().min(0).max(2_000_000_000),
  sourceEventId: z.string().trim().min(8).max(200).optional(),
  occurredAt: z.string().datetime().optional(),
}).strict().superRefine((event, ctx) => {
  if (event.kind === 'subscription_refunded' && !event.sourceEventId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceEventId'], message: 'refund must identify the original billing event' });
  }
  if (event.kind !== 'subscription_refunded' && event.sourceEventId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceEventId'], message: 'only refund events can identify a source event' });
  }
});

export type PlatformBillingEvent = z.infer<typeof billingEventSchema>;

export function parsePlatformBillingEvent(value: unknown): PlatformBillingEvent | null {
  const result = billingEventSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** Verify X-Axiom-Billing-Signature: t=<unix>,v1=<hex HMAC-SHA256>. */
export function verifyPlatformBillingSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  nowMs = Date.now(),
): boolean {
  if (!signatureHeader || !secret.trim() || rawBody.length > 65_536) return false;
  const match = /^t=(\d{10}),v1=([a-f0-9]{64})$/.exec(signatureHeader.trim());
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Math.floor(nowMs / 1000) - timestamp) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${match[1]}.${rawBody}`, 'utf8').digest();
  const received = Buffer.from(match[2], 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
