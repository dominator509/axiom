import {
  LocalObjectStorage,
  normalizeR2ObjectKey,
  withinR2ObjectLimits,
  type ObjectStorage,
  type R2ObjectScope,
} from '@axiom/llm-gateway';

export interface PreviewAsset {
  storageKey: string;
  mimeType: string;
  fileSize: number;
  sha256: Uint8Array;
}

/** The caller must authorize the asset's organization and model before this function. */
export async function assetPreview(
  asset: PreviewAsset,
  request: Request,
  root: string,
  scope: R2ObjectScope,
  storage?: ObjectStorage,
): Promise<Response> {
  let storageKey: string;
  try { storageKey = normalizeR2ObjectKey(asset.storageKey, scope); }
  catch { throw new Error('Preview unavailable'); }
  if (!withinR2ObjectLimits(asset.mimeType, asset.fileSize) || asset.sha256.length !== 32)
    throw new Error('Preview unavailable');

  const objectStorage = storage ?? new LocalObjectStorage(root);
  let metadata;
  try { metadata = await objectStorage.head(storageKey, scope); }
  catch { throw new Error('Preview unavailable'); }
  if (!metadata || metadata.size !== asset.fileSize || (metadata.mimeType !== 'unknown' && metadata.mimeType !== asset.mimeType)
    || !metadata.sha256.equals(Buffer.from(asset.sha256))) throw new Error('Preview unavailable');
  const contentType = metadata.mimeType === 'unknown' ? asset.mimeType : metadata.mimeType;

  const headers = new Headers({
    'Content-Type': contentType,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Disposition': 'inline',
    'Accept-Ranges': 'bytes',
  });
  let start = 0;
  let end = metadata.size - 1;
  const rangeHeader = request.headers.get('range');
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (match && (match[1] || match[2])) {
      if (match[1]) {
        start = Number(match[1]);
        if (match[2]) end = Math.min(Number(match[2]), end);
      } else {
        const suffix = Number(match[2]);
        start = suffix > 0 ? Math.max(0, metadata.size - suffix) : metadata.size;
      }
    } else start = metadata.size;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= metadata.size) {
      headers.set('Content-Range', `bytes */${metadata.size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${metadata.size}`);
  }
  headers.set('Content-Length', String(end - start + 1));
  const status = rangeHeader ? 206 : 200;
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  const result = await objectStorage.get(storageKey, scope, rangeHeader ? { start, end } : undefined);
  if (!result) throw new Error('Preview unavailable');
  return new Response(result.body, { status, headers });
}
