import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface ParsedFanvueWebhook {
  id: string;
  type: string;
  occurredAt: Date;
  data: Record<string, unknown>;
  digest: string;
}

const MAX_EVENT_ID = 240;
const MAX_EVENT_TYPE = 120;

/** Verify Fanvue's timestamped HMAC header against the exact raw request body. */
export function verifyFanvueWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string | undefined,
  nowMs = Date.now(),
): boolean {
  if (!secret || secret.length < 16 || !signatureHeader || rawBody.length > 1_048_576) return false;
  const parts = new Map<string, string[]>();
  for (const part of signatureHeader.split(/[\s,]+/)) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!key || !value) continue;
    parts.set(key, [...(parts.get(key) ?? []), value]);
  }
  const timestampText = parts.get('t')?.[0];
  const timestamp = timestampText && /^\d{1,12}$/.test(timestampText) ? Number(timestampText) : NaN;
  if (!Number.isSafeInteger(timestamp) || Math.abs(Math.floor(nowMs / 1000) - timestamp) > 300) return false;
  const supplied = parts.get('v0') ?? [];
  if (!supplied.length || supplied.some(value => !/^[0-9a-f]{64}$/i.test(value))) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest();
  return supplied.some(value => {
    const bytes = Buffer.from(value, 'hex');
    return bytes.length === expected.length && timingSafeEqual(expected, bytes);
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result.length > 0 && result.length <= max ? result : null;
}

function eventDate(root: Record<string, unknown>, data: Record<string, unknown>): Date | null {
  for (const value of [root.timestamp, root.created_at, root.occurred_at, data.timestamp, data.created_at, data.occurred_at]) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const date = new Date(value < 10_000_000_000 ? value * 1000 : value);
      if (Number.isFinite(date.getTime())) return date;
    }
    if (typeof value === 'string') {
      const date = new Date(value);
      if (Number.isFinite(date.getTime())) return date;
    }
  }
  return null;
}

/** Keep only a bounded event envelope; callers persist the digest, never raw payload data. */
export function parseFanvueWebhook(rawBody: string): ParsedFanvueWebhook | null {
  if (!rawBody || rawBody.length > 1_048_576) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(rawBody); } catch { return null; }
  const root = record(parsed);
  if (!root) return null;
  const data = record(root.data) ?? record(root.payload);
  if (!data) return null;
  const id = safeText(root.id ?? root.event_id, MAX_EVENT_ID);
  const type = safeText(root.type ?? root.event_type, MAX_EVENT_TYPE);
  const occurredAt = eventDate(root, data);
  if (!id || !type || !occurredAt) return null;
  return { id, type, occurredAt, data, digest: createHash('sha256').update(rawBody).digest('hex') };
}

function nestedRecord(value: unknown, key: string): Record<string, unknown> | null {
  return record(record(value)?.[key]);
}

/** Read only the documented identifiers required for an expired-subscription action. */
export function fanvueDeactivatedSubscription(event: ParsedFanvueWebhook): {
  creatorUuid: string;
  recipientUuid: string | null;
  subscriptionId: string;
  eligible: boolean;
} | null {
  if (event.type !== 'creator.subscription.deactivated') return null;
  const creatorUuid = safeText(nestedRecord(event.data, 'creator')?.uuid, 80);
  const purchaserUuid = safeText(nestedRecord(event.data, 'purchaser')?.uuid, 80);
  const recipientUuid = purchaserUuid && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(purchaserUuid)
    ? purchaserUuid : null;
  const providerSubscriptionId = safeText(event.data.id, MAX_EVENT_ID);
  const expiresAt = safeText(event.data.expires_at, 80);
  const subscriptionId = providerSubscriptionId ?? (purchaserUuid && expiresAt
    ? `cycle:${createHash('sha256').update(`${creatorUuid ?? ''}:${purchaserUuid}:${expiresAt}`).digest('hex')}`
    : `event:${event.id}`);
  const reason = safeText(event.data.deactivation_reason, 80);
  if (!creatorUuid) return null;
  return {
    creatorUuid,
    recipientUuid,
    subscriptionId,
    eligible: (reason === 'not_renewed' || reason === 'payment_failed') && recipientUuid !== null,
  };
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

/** Retain only provider campaign fields; customer profile and link URL values are discarded. */
function campaignUtm(trackingValue: unknown): Record<string, string> {
  const tracking = record(trackingValue) ?? {};
  const metadata = record(tracking.metadata) ?? tracking;
  const aliases: Record<(typeof UTM_KEYS)[number], string> = {
    utm_source: 'source', utm_medium: 'medium', utm_campaign: 'campaign', utm_content: 'content', utm_term: 'term',
  };
  const utm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = safeText(metadata[key] ?? metadata[aliases[key]], 120);
    if (value) utm[key] = value;
  }
  return utm;
}

export function fanvueSubscriptionAttribution(event: ParsedFanvueWebhook): {
  creatorUuid: string;
  subscriptionId: string;
  utm: Record<string, string>;
} | null {
  if (event.type !== 'creator.subscription.activated' && event.type !== 'creator.subscription.renewed') return null;
  const creatorUuid = safeText(nestedRecord(event.data, 'creator')?.uuid, 80);
  const subscriptionId = safeText(event.data.id, MAX_EVENT_ID);
  if (!creatorUuid || !subscriptionId) return null;
  return { creatorUuid, subscriptionId, utm: campaignUtm(event.data.tracking) };
}

export function fanvueSuccessfulPayment(event: ParsedFanvueWebhook): {
  paymentId: string;
  kind: 'subscription' | 'ppv_purchase';
  amountCents: number;
  currency: string;
  utm: Record<string, string>;
  subscriptionId: string | null;
  creatorUuid: string | null;
} | null {
  if (event.type !== 'creator.payment.succeeded') return null;
  const payment = event.data;
  const paymentId = safeText(payment.id ?? payment.uuid, MAX_EVENT_ID);
  const amount = payment.gross;
  const currency = safeText(payment.currency, 3);
  if (!paymentId || !Number.isSafeInteger(amount) || Number(amount) < 0 || Number(amount) > 1_000_000_000
    || !currency || !/^[A-Z]{3}$/.test(currency)) return null;
  const subscription = record(payment.subscription);
  return {
    paymentId,
    kind: subscription ? 'subscription' : 'ppv_purchase',
    amountCents: Number(amount),
    currency,
    utm: campaignUtm(payment.tracking),
    subscriptionId: safeText(subscription?.id, MAX_EVENT_ID),
    creatorUuid: safeText(nestedRecord(payment, 'creator')?.uuid, 80),
  };
}
