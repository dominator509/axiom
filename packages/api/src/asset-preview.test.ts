import { mkdtemp, writeFile, rm, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assetPreview, type PreviewAsset } from './asset-preview.js';

let root: string;
const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 12, 13, 14, 15]);
let asset: PreviewAsset;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'axiom-preview-'));
  await writeFile(join(root, 'image.png'), bytes);
  asset = { storageKey: 'image.png', mimeType: 'image/png', fileSize: bytes.length,
    sha256: createHash('sha256').update(bytes).digest() };
});
afterEach(async () => rm(root, { recursive: true, force: true }));

describe('authenticated asset byte delivery helper', () => {
  it('delivers exact content privately without storage metadata', async () => {
    const response = await assetPreview(asset, new Request('http://local/media'), root);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-disposition')).toBe('inline');
  });
  it.each([['bytes=2-5', 2, 5], ['bytes=-4', 12, 15], ['bytes=12-', 12, 15]])(
    'supports a single seek range %s', async (range, start, end) => {
      const response = await assetPreview(asset, new Request('http://local/media', { headers: { range } }), root);
      expect(response.status).toBe(206);
      expect(response.headers.get('content-range')).toBe(`bytes ${start}-${end}/16`);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes.subarray(start, end + 1));
    });
  it.each(['bytes=16-', 'bytes=-0', 'bytes=5-2', 'bytes=0-1,4-5', 'garbage'])(
    'rejects invalid or unsupported range %s', async range => {
      const response = await assetPreview(asset, new Request('http://local/media', { headers: { range } }), root);
      expect(response.status).toBe(416);
      expect(response.headers.get('content-range')).toBe('bytes */16');
    });
  it('provides HEAD metadata without a response stream', async () => {
    const response = await assetPreview(asset, new Request('http://local/media', { method: 'HEAD' }), root);
    expect(response.headers.get('content-length')).toBe('16');
    expect(response.body).toBeNull();
  });
  it('rejects a mismatched content hash', async () => {
    await expect(assetPreview({ ...asset, sha256: Buffer.alloc(32) }, new Request('http://local/media'), root))
      .rejects.toThrow('Preview unavailable');
  });
  it('rejects traversal and active content types', async () => {
    for (const patch of [{ storageKey: '../image.png' }, { mimeType: 'image/svg+xml' }])
      await expect(assetPreview({ ...asset, ...patch }, new Request('http://local/media'), root))
        .rejects.toThrow('Preview unavailable');
  });
  it('rejects multiply linked files', async () => {
    await link(join(root, 'image.png'), join(root, 'alias.png'));
    await expect(assetPreview(asset, new Request('http://local/media'), root)).rejects.toThrow('Preview unavailable');
  });
});
