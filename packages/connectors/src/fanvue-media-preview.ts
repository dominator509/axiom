import { readResponseBytes } from './base.js';
import type { FanvueMessageMedia } from './fanvue-message-media.js';

export type FanvuePreviewVariant = 'main' | 'thumbnail' | 'thumbnail_gallery' | 'blurred';
const MAX_CHUNK = 8 * 1024 * 1024;
const MAX_FULL = 16 * 1024 * 1024;
const MAX_ASSET = 1_610_612_736;
const MIME: Record<string, readonly string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
  video: ['video/mp4', 'video/webm'], audio: ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav'],
};

export function previewRange(value?: string): { start: number; end: number; header: string } | null {
  if (value === undefined) return null;
  const match = /^bytes=(\d{1,10})-(\d{1,10})?$/.exec(value);
  if (!match) throw new Error('Invalid preview range');
  const start = Number(match[1]), requestedEnd = match[2] ? Number(match[2]) : MAX_ASSET - 1;
  if (start >= MAX_ASSET || requestedEnd < start || requestedEnd >= MAX_ASSET) throw new Error('Invalid preview range');
  const end = Math.min(requestedEnd, start + MAX_CHUNK - 1);
  return { start, end, header: `bytes=${start}-${end}` };
}

/** Only provider-returned message media is accepted, never a client URL.
 * Exact provider-controlled host from the official media response examples:
 * https://api.fanvue.com/docs/api-reference/get-media-from-a-creators-chat
 * No redirects, no bearer/cookies, bounded buffering before API reauthorization.
 */
export async function fetchFanvuePreview(media: FanvueMessageMedia, mediaUuid: string,
  variant: FanvuePreviewVariant, transport: typeof fetch, rangeHeader?: string) {
  const range = previewRange(rangeHeader);
  const item = media.results[mediaUuid];
  const variants = item?.variants?.filter(v => v.variantType === variant && v.url);
  if (!item || !variants || variants.length !== 1 || !MIME[item.mediaType]) throw new Error('Preview unavailable');
  const url = new URL(variants[0].url!);
  if (url.protocol !== 'https:' || url.hostname !== 'media.fanvue.com' || url.port || url.username || url.password || url.hash)
    throw new Error('Preview unavailable');
  const expectedType = variant === 'main' ? item.mediaType : 'image';
  let response: Response | undefined;
  try {
    response = await transport(url.href, { method: 'GET', redirect: 'manual', credentials: 'omit',
      headers: { 'Accept-Encoding': 'identity', ...(range ? { Range: range.header } : {}) },
      signal: AbortSignal.timeout(30_000) });
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    if (![200, 206].includes(response.status) || !MIME[expectedType].includes(contentType)
      || (response.headers.has('content-encoding') && response.headers.get('content-encoding') !== 'identity'))
      throw new Error('Preview unavailable');
    const contentRange = response.headers.get('content-range');
    let expectedLength: number | undefined;
    if (response.status === 206) {
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange ?? '');
      if (!range || !match) throw new Error('Preview unavailable');
      const [start, end, total] = match.slice(1).map(Number);
      if (![start, end, total].every(Number.isSafeInteger) || start !== range.start || end < start
        || end > range.end || total <= end || total > MAX_ASSET) throw new Error('Preview unavailable');
      expectedLength = end - start + 1;
    } else if (contentRange || (range && range.start !== 0)) throw new Error('Preview unavailable');
    const bytes = await readResponseBytes(response, range ? MAX_CHUNK : MAX_FULL, 'Preview');
    const declared = response.headers.get('content-length');
    if (!bytes.length || (expectedLength !== undefined && bytes.length !== expectedLength)
      || (declared !== null && bytes.length !== Number(declared))
      || (response.status === 200 && range && bytes.length > range.end + 1)) throw new Error('Preview unavailable');
    return { bytes, contentType, contentRange, status: response.status as 200 | 206 };
  } catch {
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => undefined);
    // Transport errors can contain signed URLs. Never forward them to logs/UI.
    throw new Error('Preview unavailable');
  }
}
