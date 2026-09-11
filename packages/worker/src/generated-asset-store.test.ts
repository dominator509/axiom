import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { storeGeneratedAsset } from './generated-asset-store.js';

let root: string;
const orgId = '00000000-0000-4000-8000-000000000001';
const modelId = '00000000-0000-4000-8000-000000000002';
const bytes = Buffer.from([255, 216, 255, ...Array(20).fill(7)]);
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'axiom-generated-asset-'));
  await mkdir(join(root, 'request'));
  await writeFile(join(root, 'request', '1.jpg'), bytes);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const input = () => ({ path: join(root, 'request', '1.jpg'), byteLength: bytes.length, mimeType: 'image/jpeg' as const });
const scope = () => ({ orgId, modelId, requestRoot: join(root, 'request'), mediaRoot: join(root, 'media') });

describe('generated asset persistence', () => {
  it('copies exact bytes with tenant-scoped key and content hash, retaining source', async () => {
    const result = await storeGeneratedAsset(input(), scope());
    expect(result.storageKey).toMatch(new RegExp(`^generated/${orgId}/${modelId}/[a-f0-9-]+\\.jpg$`));
    expect(await readFile(join(root, 'media', result.storageKey))).toEqual(bytes);
    expect(await readFile(input().path)).toEqual(bytes);
    expect(result.sha256).toEqual(createHash('sha256').update(bytes).digest());
    expect(result.fileSize).toBe(bytes.length);
  });
  it('rejects a source outside the request before copying', async () => {
    const outside = join(root, 'outside.jpg');
    await writeFile(outside, bytes);
    await expect(storeGeneratedAsset({ ...input(), path: outside }, scope())).rejects.toThrow('outside');
  });
  it('rejects path-shaped tenant identifiers', async () => {
    await expect(storeGeneratedAsset(input(), { ...scope(), orgId: '../escape' })).rejects.toThrow('scope');
  });
  it('rejects changed source length without leaving a destination file', async () => {
    await expect(storeGeneratedAsset({ ...input(), byteLength: bytes.length + 1 }, scope())).rejects.toThrow('changed');
    expect(await readdir(join(root, 'media', 'generated', orgId, modelId))).toEqual([]);
  });
  it('does not overwrite existing assets', async () => {
    const first = await storeGeneratedAsset(input(), scope());
    const second = await storeGeneratedAsset(input(), scope());
    expect(first.storageKey).not.toBe(second.storageKey);
    expect(first.sha256).toEqual(second.sha256);
  });
  it('removes a partial destination if the media signature changed', async () => {
    await writeFile(input().path, Buffer.alloc(bytes.length));
    await expect(storeGeneratedAsset(input(), scope())).rejects.toThrow('type changed');
    expect(await readdir(join(root, 'media', 'generated', orgId, modelId))).toEqual([]);
  });
});
