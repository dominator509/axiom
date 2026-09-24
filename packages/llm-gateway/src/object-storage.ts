import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  loadR2Storage,
  normalizeR2ObjectKey,
  signedR2Request,
  withinR2ObjectLimits,
  type R2ObjectKeyKind,
  type R2ObjectScope,
  type R2Storage,
} from './grok-r2-storage.js';

export type ObjectStorageScope = R2ObjectScope;

export interface StorageObjectMetadata {
  key: string;
  size: number;
  mimeType: string;
  sha256: Buffer;
  retainUntilMs?: number;
}

export interface StorageObjectRead {
  metadata: StorageObjectMetadata;
  body: Buffer;
  range?: { start: number; end: number };
}

export interface StoragePutInput {
  key: string;
  scope: ObjectStorageScope;
  kind?: R2ObjectKeyKind;
  body: Uint8Array;
  mimeType: string;
  retainUntilMs?: number;
}

export type StorageDeleteResult = 'deleted' | 'not_found' | 'retained' | 'unknown';

export interface ObjectStorage {
  put(input: StoragePutInput): Promise<StorageObjectMetadata>;
  head(key: string, scope: ObjectStorageScope, kind?: R2ObjectKeyKind): Promise<StorageObjectMetadata | null>;
  get(key: string, scope: ObjectStorageScope, range?: { start: number; end: number }, kind?: R2ObjectKeyKind): Promise<StorageObjectRead | null>;
  delete(key: string, scope: ObjectStorageScope, kind?: R2ObjectKeyKind): Promise<StorageDeleteResult>;
}

function checkedKey(key: string, scope: ObjectStorageScope, kind: R2ObjectKeyKind = 'asset'): string {
  return normalizeR2ObjectKey(key, scope, kind);
}

function checkedBody(body: Uint8Array, mimeType: string): Buffer {
  const bytes = Buffer.from(body);
  if (!withinR2ObjectLimits(mimeType, bytes.byteLength)) throw new Error('Invalid object metadata');
  return bytes;
}

function checkedRetention(retainUntilMs: number | undefined): number | undefined {
  if (retainUntilMs === undefined) return undefined;
  if (!Number.isSafeInteger(retainUntilMs) || retainUntilMs < 0) throw new Error('Invalid object retention');
  return retainUntilMs;
}

function checkedRange(range: { start: number; end: number } | undefined, size: number): { start: number; end: number } | undefined {
  if (!range) return undefined;
  if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)
    || range.start < 0 || range.end < range.start || range.end >= size) throw new Error('Invalid object range');
  return range;
}

function metadataHash(bytes: Uint8Array): Buffer {
  return createHash('sha256').update(bytes).digest();
}

/** Deterministic, tenant-confined adapter used by local source tests and local development. */
export class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly root: string) {}

  private async pathFor(key: string, scope: ObjectStorageScope, kind: R2ObjectKeyKind = 'asset'): Promise<string> {
    const safeKey = checkedKey(key, scope, kind);
    const base = resolve(this.root);
    await mkdir(base, { recursive: true, mode: 0o700 });
    if (await (await import('node:fs/promises')).realpath(base) !== base) throw new Error('Unsafe object storage root');
    const path = resolve(base, safeKey);
    const local = relative(base, path);
    if (!local || isAbsolute(local) || local.split(sep).includes('..')) throw new Error('Object escapes storage root');
    return path;
  }

  private metadataPath(path: string): string { return `${path}.axiom-meta.json`; }

  async put(input: StoragePutInput): Promise<StorageObjectMetadata> {
    const body = checkedBody(input.body, input.mimeType);
    const retainUntilMs = checkedRetention(input.retainUntilMs);
    const path = await this.pathFor(input.key, input.scope, input.kind);
    const parent = resolve(path, '..');
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const metadata: StorageObjectMetadata = {
      key: checkedKey(input.key, input.scope, input.kind), size: body.byteLength,
      mimeType: input.mimeType, sha256: metadataHash(body), ...(retainUntilMs === undefined ? {} : { retainUntilMs }),
    };
    const temporary = `${path}.${randomUUID()}.tmp`;
    const temporaryMeta = `${this.metadataPath(path)}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, body, { flag: 'wx', mode: 0o600 });
      await writeFile(temporaryMeta, JSON.stringify({ ...metadata, sha256: metadata.sha256.toString('hex') }), { flag: 'wx', mode: 0o600 });
      await rename(temporary, path);
      await rename(temporaryMeta, this.metadataPath(path));
      return metadata;
    } finally {
      await rm(temporary, { force: true });
      await rm(temporaryMeta, { force: true });
    }
  }

  async head(key: string, scope: ObjectStorageScope, kind: R2ObjectKeyKind = 'asset'): Promise<StorageObjectMetadata | null> {
    const path = await this.pathFor(key, scope, kind);
    try {
      const file = await stat(path);
      if (!file.isFile() || file.nlink !== 1 || await (await import('node:fs/promises')).realpath(path) !== path)
        throw new Error('Object metadata integrity failure');
      let raw: string;
      try { raw = await readFile(this.metadataPath(path), 'utf8'); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        // Existing local deployments predate the sidecar metadata file. The
        // authenticated DB row remains authoritative for MIME and size; this
        // fallback supplies only the verified bytes and preserves migration
        // compatibility without weakening tenant/path checks.
        const body = await readFile(path);
        return { key: checkedKey(key, scope, kind), size: file.size, mimeType: 'unknown', sha256: metadataHash(body) };
      }
      const parsed = JSON.parse(raw) as { key?: unknown; size?: unknown; mimeType?: unknown; sha256?: unknown; retainUntilMs?: unknown };
      if (!file.isFile() || parsed.key !== checkedKey(key, scope, kind) || parsed.size !== file.size
        || typeof parsed.mimeType !== 'string' || typeof parsed.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.sha256)
        || (parsed.retainUntilMs !== undefined && !Number.isSafeInteger(parsed.retainUntilMs))) throw new Error('Object metadata integrity failure');
      const retainUntilMs = parsed.retainUntilMs === undefined ? undefined : Number(parsed.retainUntilMs);
      if (retainUntilMs !== undefined && !Number.isSafeInteger(retainUntilMs)) throw new Error('Object metadata integrity failure');
      return {
        key: parsed.key, size: parsed.size, mimeType: parsed.mimeType, sha256: Buffer.from(parsed.sha256, 'hex'),
        ...(retainUntilMs === undefined ? {} : { retainUntilMs }),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async get(key: string, scope: ObjectStorageScope, range?: { start: number; end: number }, kind: R2ObjectKeyKind = 'asset'): Promise<StorageObjectRead | null> {
    const metadata = await this.head(key, scope, kind);
    if (!metadata) return null;
    const path = await this.pathFor(key, scope, kind);
    const body = await readFile(path);
    if (body.byteLength !== metadata.size || !metadataHash(body).equals(metadata.sha256)) throw new Error('Object content integrity failure');
    const bounded = checkedRange(range, body.byteLength);
    return bounded
      ? { metadata, body: body.subarray(bounded.start, bounded.end + 1), range: bounded }
      : { metadata, body };
  }

  async delete(key: string, scope: ObjectStorageScope, kind: R2ObjectKeyKind = 'asset'): Promise<StorageDeleteResult> {
    const metadata = await this.head(key, scope, kind);
    if (!metadata) return 'not_found';
    if (metadata.retainUntilMs !== undefined && metadata.retainUntilMs > Date.now()) return 'retained';
    const path = await this.pathFor(key, scope, kind);
    try {
      await rm(path, { force: false });
      await rm(this.metadataPath(path), { force: true });
      return 'deleted';
    } catch { return 'unknown'; }
  }
}

/** R2 adapter over the existing signed request contract; tests inject fetch and never contact a bucket. */
export class R2ObjectStorage implements ObjectStorage {
  constructor(private readonly config: R2Storage) {}

  async put(input: StoragePutInput): Promise<StorageObjectMetadata> {
    const key = checkedKey(input.key, input.scope, input.kind);
    const body = checkedBody(input.body, input.mimeType);
    const retainUntilMs = checkedRetention(input.retainUntilMs);
    const response = await signedR2Request(this.config, 'PUT', key, body, {
      contentType: input.mimeType,
      metadata: {
        'x-amz-meta-axiom-sha256': metadataHash(body).toString('hex'),
        ...(retainUntilMs === undefined ? {} : { 'x-amz-meta-axiom-retain-until': String(retainUntilMs) }),
      },
    });
    if (!response.ok) throw new Error(`R2 PUT returned HTTP ${response.status}`);
    return { key, size: body.byteLength, mimeType: input.mimeType, sha256: metadataHash(body), ...(retainUntilMs === undefined ? {} : { retainUntilMs }) };
  }

  async head(key: string, scope: ObjectStorageScope, kind: R2ObjectKeyKind = 'asset'): Promise<StorageObjectMetadata | null> {
    const safeKey = checkedKey(key, scope, kind);
    const response = await signedR2Request(this.config, 'HEAD', safeKey);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`R2 HEAD returned HTTP ${response.status}`);
    const size = Number(response.headers.get('content-length'));
    const mimeType = response.headers.get('content-type');
    const digest = response.headers.get('x-amz-meta-axiom-sha256');
    const retention = response.headers.get('x-amz-meta-axiom-retain-until');
    const retainUntilMs = retention === null ? undefined : Number(retention);
    if (!Number.isSafeInteger(size) || !mimeType || !digest || !/^[a-f0-9]{64}$/i.test(digest)
      || (retention !== null && !Number.isSafeInteger(retainUntilMs))) throw new Error('R2 object metadata is incomplete');
    return { key: safeKey, size, mimeType, sha256: Buffer.from(digest, 'hex'), ...(retainUntilMs === undefined ? {} : { retainUntilMs }) };
  }

  async get(key: string, scope: ObjectStorageScope, range?: { start: number; end: number }, kind: R2ObjectKeyKind = 'asset'): Promise<StorageObjectRead | null> {
    const metadata = await this.head(key, scope, kind);
    if (!metadata) return null;
    const bounded = checkedRange(range, metadata.size);
    const response = await signedR2Request(this.config, 'GET', metadata.key, undefined, {
      range: bounded ? `bytes=${bounded.start}-${bounded.end}` : undefined,
    });
    if (!response.ok) throw new Error(`R2 GET returned HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    if (!bounded && !metadataHash(body).equals(metadata.sha256)) throw new Error('R2 object content integrity failure');
    return bounded ? { metadata, body, range: bounded } : { metadata, body };
  }

  async delete(key: string, scope: ObjectStorageScope, kind: R2ObjectKeyKind = 'asset'): Promise<StorageDeleteResult> {
    const metadata = await this.head(key, scope, kind);
    if (!metadata) return 'not_found';
    if (metadata.retainUntilMs !== undefined && metadata.retainUntilMs > Date.now()) return 'retained';
    const response = await signedR2Request(this.config, 'DELETE', metadata.key);
    if (response.status === 404) return 'not_found';
    return response.ok ? 'deleted' : 'unknown';
  }
}

/** Resolve the configured tenant storage without allowing a provider fallback
 * to bypass an encrypted record. Missing configuration deliberately selects
 * the deterministic private filesystem adapter for local/test operation. */
export function createObjectStorage(scope: { userId: string; orgId: string }, localRoot: string): ObjectStorage {
  const config = loadR2Storage(scope);
  return config ? new R2ObjectStorage(config) : new LocalObjectStorage(localRoot);
}
