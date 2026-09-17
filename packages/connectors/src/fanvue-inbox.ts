import { z } from 'zod';

// Official Fanvue OpenAPI /chats and /chats/{userUuid}/messages, retrieved
// 2026-09-17 from https://api.fanvue.com/docs/openapi.json; version 2025-06-26.
const uuid = z.string().uuid();
const text = z.string().max(100_000).nullable();
const date = z.string().max(64).nullable(); // Provider labels these date, not uniformly date-time.
const mediaType = z.enum(['image', 'video', 'audio', 'document']).nullable();
const pagination = z.object({ page: z.number().int().positive().safe(), size: z.number().int().min(0).max(50), hasMore: z.boolean() });
const chat = z.object({
  createdAt: date, lastMessageAt: date, isRead: z.boolean(), isMuted: z.boolean(),
  unreadMessagesCount: z.number().int().nonnegative().safe(),
  user: z.object({ uuid, handle: z.string().max(1000), displayName: z.string().max(1000),
    nickname: z.string().max(1000).nullable(), isTopSpender: z.boolean() }),
  lastMessage: z.object({
    uuid: z.string().min(1).max(100), text, type: z.string().min(1).max(100), sentAt: date,
    hasMedia: z.boolean().nullable(), hasGif: z.boolean(), mediaType, senderUuid: uuid,
    senderRole: z.enum(['FAN', 'CREATOR', 'AGENCY', 'SYSTEM']), sentByUserId: uuid.nullable(),
    status: z.enum(['Sent', 'Delivered', 'Read']).nullable().optional(),
  }).nullable(),
});
const message = z.object({
  uuid, text, sentAt: date, sender: z.object({ uuid, handle: z.string().max(1000) }),
  recipient: z.object({ uuid: uuid.optional(), handle: z.string().max(1000).optional() }),
  hasMedia: z.boolean().nullable(), mediaType, mediaUuids: z.array(uuid).max(100), mediaPreviewUuid: uuid.nullable(),
  // Do not forward third-party hotlink URLs to the browser. Keep attachment
  // identity/description so a GIF-only message is not mistaken for empty text.
  gif: z.object({ id: z.string().max(1000), title: text, format: z.enum(['GIF', 'WEBP', 'MP4', 'WEBM']) }).nullable(),
  type: z.string().min(1).max(100),
  pricing: z.object({ USD: z.object({ price: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER) }) }).nullable(),
  purchasedAt: date, tipSource: z.enum(['chat', 'post', 'media_link']).nullable(),
  sentByUserId: uuid.nullable(), appUuid: uuid.nullable(), isRead: z.boolean(),
});
const chats = z.object({ data: z.array(chat).max(50), pagination });
const messages = z.object({ data: z.array(message).max(50), pagination });
export type FanvueChatPage = z.infer<typeof chats>;
export type FanvueMessagePage = z.infer<typeof messages>;

/** Outcome after a send was attempted. Uncertain must never be automatically retried. */
export class FanvueMessageDeliveryError extends Error {
  constructor(public readonly outcome: 'rejected' | 'uncertain', public readonly status?: number) {
    super(outcome === 'rejected' ? 'Fanvue rejected the message' : 'Fanvue message delivery is unconfirmed');
    this.name = 'FanvueMessageDeliveryError';
  }
}

export function replyText(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 5000)
    throw new Error('Fanvue reply must contain 1 to 5000 characters');
  return value; // Preserve the exact text approved by the user.
}

export function messageReceipt(value: unknown): { messageUuid: string } {
  const result = z.object({ messageUuid: uuid }).safeParse(value);
  if (!result.success) throw new FanvueMessageDeliveryError('uncertain');
  return result.data;
}

export function inboxPageQuery(page: number, size: number): URLSearchParams {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(size) || size < 1 || size > 50)
    throw new Error('Invalid Fanvue inbox pagination');
  return new URLSearchParams({ page: String(page), size: String(size) });
}

export function inboxUserUuid(value: string): string {
  if (!uuid.safeParse(value).success) throw new Error('Invalid Fanvue inbox user');
  return value;
}

export function parseChatPage(value: unknown, page: number, size: number): FanvueChatPage {
  const result = chats.safeParse(value);
  if (!result.success || result.data.pagination.page !== page || result.data.data.length > size
    || result.data.pagination.size !== result.data.data.length)
    throw new Error('Invalid Fanvue chat response contract');
  return result.data;
}

export function parseMessagePage(value: unknown, page: number, size: number): FanvueMessagePage {
  const result = messages.safeParse(value);
  if (!result.success || result.data.pagination.page !== page || result.data.data.length > size
    || result.data.pagination.size !== result.data.data.length)
    throw new Error('Invalid Fanvue message response contract');
  return result.data;
}
