import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createObjectStorage, LocalObjectStorage, R2ObjectStorage } from './object-storage.js';

const scope = {
  orgId: '00000000-0000-4000-8000-000000000001',
  modelId: '00000000-0000-4000-8000-000000000002',
};
const otherScope = { ...scope, orgId: '00000000-0000-4000-8000-000000000003' };
const key = `generated/${scope.orgId}/${scope.modelId}/asset.png`;
const body = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const hash = createHash('sha256').update(body).digest();
const config = {
  endpoint: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
  bucket: 'fanthynks-test',
  accessKeyId: '0123456789abcdef0123456789abcdef',
  secretAccessKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

describe('object storage ports', () => {
  let root: string | undefined;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

  it('local adapter covers metadata, range, checksum, retention and tenant confinement', async () => {
    root = await mkdtemp(join(tmpdir(), 'axiom-object-storage-'));
    const storage = new LocalObjectStorage(root);
    const stored = await storage.put({ key, scope, body, mimeType: 'image/png' });
    expect(stored).toMatchObject({ key, size: body.length, mimeType: 'image/png' });
    expect(stored.sha256).toEqual(hash);
    expect((await storage.head(key, scope))?.sha256).toEqual(hash);
    expect((await storage.get(key, scope, { start: 2, end: 5 }))?.body).toEqual(body.subarray(2, 6));
    await expect(storage.get(key, otherScope)).rejects.toThrow('scope');
    await expect(storage.put({ key: `generated/${scope.orgId}/${scope.modelId}/../escape.png`, scope, body, mimeType: 'image/png' }))
      .rejects.toThrow('Invalid R2 object key');

    const retainedKey = `generated/${scope.orgId}/${scope.modelId}/retained.png`;
    await storage.put({ key: retainedKey, scope, body, mimeType: 'image/png', retainUntilMs: Number.MAX_SAFE_INTEGER });
    expect(await storage.delete(retainedKey, scope)).toBe('retained');
    expect(await storage.delete(key, scope)).toBe('deleted');
    expect(await storage.head(key, scope)).toBeNull();
  });

  it('R2 adapter signs bounded operations and redacts provider failures', async () => {
    const calls: RequestInit[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      calls.push(init ?? {});
      const method = init?.method;
      if (method === 'PUT') return new Response(null, { status: 200 });
      if (method === 'HEAD') return new Response(null, {
        status: 200,
        headers: {
          'content-length': String(body.length),
          'content-type': 'image/png',
          'x-amz-meta-axiom-sha256': hash.toString('hex'),
        },
      });
      if (method === 'GET') {
        const headers = init?.headers as Record<string, string> | undefined;
        return new Response(headers?.Range === 'bytes=1-4' ? body.subarray(1, 5) : body, { status: 200 });
      }
      return new Response(null, { status: 204 });
    });
    try {
      const storage = new R2ObjectStorage(config);
      await storage.put({ key, scope, body, mimeType: 'image/png' });
      const result = await storage.get(key, scope, { start: 1, end: 4 });
      expect(result?.body).toEqual(body.subarray(1, 5));
      expect(calls.some(call => Object.keys(call.headers as Record<string, string>)
        .some(name => name.toLowerCase() === 'authorization'))).toBe(true);
      const rangeCall = calls.find(call => call.method === 'GET');
      expect(rangeCall?.headers).toMatchObject({ Range: 'bytes=1-4' });
    } finally { fetchMock.mockRestore(); }

    const failure = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('secret provider detail', { status: 403 }));
    try {
      await expect(new R2ObjectStorage(config).put({ key, scope, body, mimeType: 'image/png' }))
        .rejects.toThrow('R2 PUT returned HTTP 403');
    } finally { failure.mockRestore(); }
  });

  it('reports not_found and unknown delete outcomes and rejects cross-tenant R2 keys', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const method = init?.method;
      if (method === 'HEAD') return new Response(null, { status: 404 });
      return new Response(null, { status: 204 });
    });
    try {
      const storage = new R2ObjectStorage(config);
      expect(await storage.delete(key, scope)).toBe('not_found');
      expect(await storage.head(key, scope)).toBeNull();
      await expect(storage.put({
        key: `generated/${otherScope.orgId}/${scope.modelId}/asset.png`, scope, body, mimeType: 'image/png',
      })).rejects.toThrow();
    } finally { fetchMock.mockRestore(); }

    const unknown = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method === 'HEAD') return new Response(null, {
        status: 200,
        headers: {
          'content-length': String(body.length),
          'content-type': 'image/png',
          'x-amz-meta-axiom-sha256': hash.toString('hex'),
        },
      });
      return new Response(null, { status: 500 });
    });
    try {
      expect(await new R2ObjectStorage(config).delete(key, scope)).toBe('unknown');
    } finally { unknown.mockRestore(); }
  });

  it('resolves the unconfigured tenant to the local adapter without mutating the filesystem', async () => {
    const previousDir = process.env.AXIOM_R2_STORAGE_DIR;
    const previousKey = process.env.AXIOM_STORAGE_ENCRYPTION_KEY;
    root = await mkdtemp(join(tmpdir(), 'axiom-object-storage-unconfigured-'));
    delete process.env.AXIOM_R2_STORAGE_DIR;
    delete process.env.AXIOM_STORAGE_ENCRYPTION_KEY;
    try {
      const storage = createObjectStorage({ userId: scope.orgId, orgId: scope.orgId }, root);
      expect(storage).toBeInstanceOf(LocalObjectStorage);
      // Resolution alone must not create or write any path under the local root.
      expect(await readdir(root)).toEqual([]);
    } finally {
      if (previousDir === undefined) delete process.env.AXIOM_R2_STORAGE_DIR;
      else process.env.AXIOM_R2_STORAGE_DIR = previousDir;
      if (previousKey === undefined) delete process.env.AXIOM_STORAGE_ENCRYPTION_KEY;
      else process.env.AXIOM_STORAGE_ENCRYPTION_KEY = previousKey;
    }
  });
});
