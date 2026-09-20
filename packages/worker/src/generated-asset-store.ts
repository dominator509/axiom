import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  LocalObjectStorage,
  normalizeR2ObjectKey,
  withinR2ObjectLimits,
  type ObjectStorage,
} from '@axiom/llm-gateway';
import { sanitizeMedia } from './media-sanitizer.js';

export interface GeneratedAssetInput {
  path: string;
  byteLength: number;
  mimeType: 'image/jpeg' | 'image/png' | 'video/mp4' | 'video/webm';
}

function hasSupportedSignature(bytes: Uint8Array, mimeType: GeneratedAssetInput['mimeType']): boolean {
  if (bytes.byteLength < 12) return false;
  const buffer = Buffer.from(bytes);
  return mimeType === 'image/jpeg'
    ? buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    : mimeType === 'image/png'
      ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mimeType === 'video/webm'
        ? buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
        : buffer.toString('ascii', 4, 8) === 'ftyp';
}

/** Persist a completed artifact through the provider-neutral object-storage port. */
export async function storeGeneratedAsset(input: GeneratedAssetInput, scope: {
  orgId: string;
  modelId: string;
  requestRoot: string;
  mediaRoot: string;
  storage?: ObjectStorage;
  retainUntilMs?: number;
  sanitizeMetadata?: boolean;
}): Promise<{
  storageKey: string;
  fileName: string;
  fileSize: number;
  sha256: Buffer;
  mimeType: GeneratedAssetInput['mimeType'];
  exactFileHashChanged: boolean;
}> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(scope.orgId) || !uuid.test(scope.modelId)) throw new Error('Invalid asset tenant scope');
  if (scope.sanitizeMetadata && input.mimeType === 'video/webm') throw new Error('WebM sanitization is not supported');
  if (!withinR2ObjectLimits(input.mimeType, input.byteLength)) throw new Error('Invalid generated asset metadata');

  const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'video/mp4': 'mp4', 'video/webm': 'webm' } as const;
  const requestRoot = await realpath(scope.requestRoot);
  const source = resolve(input.path);
  const local = relative(requestRoot, source);
  if (!local || isAbsolute(local) || local.split(sep).includes('..') || await realpath(source) !== source)
    throw new Error('Generated asset is outside its request directory');
  // Preserve the existing cleanup/inspection contract: the tenant/model
  // directory exists even when a later source validation rejects the import.
  await mkdir(join(resolve(scope.mediaRoot), 'generated', scope.orgId, scope.modelId), { recursive: true, mode: 0o700 });

  const before = await stat(source);
  if (!before.isFile() || before.nlink !== 1 || before.size !== input.byteLength)
    throw new Error('Generated asset changed before import');
  const original = await readFile(source);
  if (original.byteLength !== input.byteLength || !hasSupportedSignature(original, input.mimeType))
    throw new Error('Generated asset type changed before import');
  const after = await stat(source);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
    throw new Error('Generated asset changed during import');

  const mimeType = scope.sanitizeMetadata && input.mimeType !== 'video/mp4' ? 'image/png' : input.mimeType;
  const sanitized = scope.sanitizeMetadata
    ? await sanitizeMedia(original, input.mimeType)
    : { bytes: original, mimeType: input.mimeType, exactFileHashChanged: false };
  if (sanitized.mimeType !== mimeType || !withinR2ObjectLimits(mimeType, sanitized.bytes.byteLength))
    throw new Error('Sanitizer output type or size mismatch');

  const fileName = `${randomUUID()}.${extensions[mimeType]}`;
  const storageKey = normalizeR2ObjectKey(`generated/${scope.orgId}/${scope.modelId}/${fileName}`, {
    orgId: scope.orgId,
    modelId: scope.modelId,
  });
  const storage = scope.storage ?? new LocalObjectStorage(scope.mediaRoot);
  const stored = await storage.put({
    key: storageKey,
    scope: { orgId: scope.orgId, modelId: scope.modelId },
    body: sanitized.bytes,
    mimeType,
    retainUntilMs: scope.retainUntilMs,
  });
  return {
    storageKey,
    fileName,
    fileSize: stored.size,
    sha256: stored.sha256,
    mimeType,
    exactFileHashChanged: sanitized.exactFileHashChanged,
  };
}

export function hashGeneratedAsset(bytes: Uint8Array): Buffer {
  return createHash('sha256').update(bytes).digest();
}
