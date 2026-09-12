import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

export interface PreviewAsset {
  storageKey: string;
  mimeType: string;
  fileSize: number;
  sha256: Uint8Array;
}

/** The caller must authorize the asset's organization AND model first.
 * Never accept a client-supplied path. Keep the media root private to services.
 */
export async function assetPreview(asset: PreviewAsset, request: Request, root: string): Promise<Response> {
  const limit = asset.mimeType === 'video/mp4' ? 256 * 1024 * 1024 : 20 * 1024 * 1024;
  if (!['image/jpeg', 'image/png', 'video/mp4'].includes(asset.mimeType)
    || !Number.isSafeInteger(asset.fileSize) || asset.fileSize < 12 || asset.fileSize > limit
    || asset.sha256.length !== 32) throw new Error('Preview unavailable');
  const base = resolve(root);
  const path = resolve(base, asset.storageKey);
  const local = relative(base, path);
  if (isAbsolute(asset.storageKey) || !local || isAbsolute(local) || local.split(sep).includes('..')
    || await realpath(base) !== base || await realpath(path) !== path)
    throw new Error('Preview unavailable');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let streaming = false;
  try {
    const before = await file.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size !== asset.fileSize)
      throw new Error('Preview unavailable');
    // Check the stored content identity before handing bytes to the browser.
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let offset = 0;
    while (offset < before.size) {
      if (request.signal.aborted) throw new Error('Preview unavailable');
      const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, before.size - offset), offset);
      if (!bytesRead) throw new Error('Preview unavailable');
      if (offset === 0) {
        const matches = asset.mimeType === 'image/png'
          ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : asset.mimeType === 'image/jpeg'
            ? buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
            : buffer.toString('ascii', 4, 8) === 'ftyp';
        if (bytesRead < 12 || !matches) throw new Error('Preview unavailable');
      }
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await file.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
      || !hash.digest().equals(Buffer.from(asset.sha256))) throw new Error('Preview unavailable');
    const headers = new Headers({
      'Content-Type': asset.mimeType,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Disposition': 'inline',
      'Accept-Ranges': 'bytes',
    });
    let start = 0;
    let end = before.size - 1;
    const range = request.headers.get('range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match && (match[1] || match[2])) {
        if (match[1]) {
          start = Number(match[1]);
          if (match[2]) end = Math.min(Number(match[2]), end);
        } else {
          const suffix = Number(match[2]);
          start = suffix > 0 ? Math.max(0, before.size - suffix) : before.size;
        }
      } else start = before.size;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= before.size) {
        headers.set('Content-Range', `bytes */${before.size}`);
        return new Response(null, { status: 416, headers });
      }
      headers.set('Content-Range', `bytes ${start}-${end}/${before.size}`);
    }
    headers.set('Content-Length', String(end - start + 1));
    const status = range ? 206 : 200;
    if (request.method === 'HEAD') return new Response(null, { status, headers });
    const body = Readable.toWeb(file.createReadStream({ start, end, autoClose: true }));
    streaming = true;
    return new Response(body as ReadableStream<Uint8Array>, { status, headers });
  } finally {
    if (!streaming) await file.close();
  }
}
