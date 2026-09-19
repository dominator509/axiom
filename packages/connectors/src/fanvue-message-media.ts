import { z } from 'zod';

// Official /chats/{userUuid}/messages/{messageUuid}/media contract, retrieved
// 2026-09-17: https://api.fanvue.com/docs/openapi.json (API version 2025-06-26).
const uuid = z.string().uuid();
const date = z.string().max(64).nullable();
const price = z.object({ USD: z.object({ price: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER) }) }).nullable().optional();
const variantType = z.enum(['main', 'thumbnail', 'thumbnail_gallery', 'blurred']);
const dimension = z.number().finite().nonnegative().nullable();
const signedUrl = z.string().max(16384).url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
});
const media = z.object({
  uuid, messageUuid: uuid, ownerUuid: uuid,
  mediaType: z.enum(['image', 'video', 'audio', 'document', 'unknown']),
  created_at: date, sentAt: date, name: z.string().max(10000).nullable(),
  variants: z.array(z.object({
    variantType, displayPosition: z.number().finite(), url: signedUrl.optional(),
    width: dimension, height: dimension, lengthMs: dimension,
  })).max(100).optional(),
  purchasedAt: date.optional(), pricing: price, amountPaid: price,
});
const result = z.object({
  results: z.record(uuid, media.nullable()),
  errors: z.array(z.object({ mediaUuid: uuid, code: z.enum(['NOT_IN_MESSAGE', 'INTERNAL']) })).max(20),
});
export type FanvueMessageMedia = z.infer<typeof result>;

export function messageMediaQuery(userUuid: string, messageUuid: string, mediaUuids: string[]): URLSearchParams {
  if (!uuid.safeParse(userUuid).success || !uuid.safeParse(messageUuid).success
    || !Array.isArray(mediaUuids) || mediaUuids.length < 1 || mediaUuids.length > 20
    || new Set(mediaUuids).size !== mediaUuids.length || mediaUuids.some(id => !uuid.safeParse(id).success))
    throw new Error('Invalid Fanvue message media selection');
  return new URLSearchParams({ mediaUuids: mediaUuids.join(',') });
}

/** Server-side only: signed variant URLs must not be serialized to the dashboard.
 * URL shape validation is NOT an SSRF boundary; the eventual byte proxy must
 * enforce provider-host/egress restrictions, redirects, byte limits and MIME.
 */
export function parseMessageMedia(value: unknown, messageUuid: string, mediaUuids: string[]): FanvueMessageMedia {
  messageMediaQuery(messageUuid, messageUuid, mediaUuids);
  const parsed = result.safeParse(value);
  const invalid = () => new Error('Invalid Fanvue message media response contract');
  if (!parsed.success) throw invalid();
  const requested = new Set(mediaUuids);
  const errors = new Set<string>();
  for (const error of parsed.data.errors) {
    if (!requested.has(error.mediaUuid) || errors.has(error.mediaUuid)) throw invalid();
    errors.add(error.mediaUuid);
  }
  for (const [key, item] of Object.entries(parsed.data.results)) {
    if (!requested.has(key) || (item && (item.uuid !== key || item.messageUuid !== messageUuid || errors.has(key)))) throw invalid();
  }
  for (const id of requested) {
    if (!(id in parsed.data.results) && !errors.has(id)) throw invalid();
  }
  return parsed.data;
}
