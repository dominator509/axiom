import { constants } from 'node:fs';
import { mkdir, open, realpath, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface GeneratedAssetInput {
  path: string;
  byteLength: number;
  mimeType: 'image/jpeg' | 'image/png' | 'video/mp4';
}

/** Persist a completed CLI artifact beneath the existing media-plane root.
 * No DB row should refer to the returned key before this durable copy succeeds.
 * The original is retained for reconciliation if a later DB operation fails.
 */
export async function storeGeneratedAsset(input: GeneratedAssetInput, scope: {
  orgId: string; modelId: string; requestRoot: string; mediaRoot: string;
}): Promise<{ storageKey: string; fileName: string; fileSize: number; sha256: Buffer }> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(scope.orgId) || !uuid.test(scope.modelId)) throw new Error('Invalid asset tenant scope');
  const limit = input.mimeType === 'video/mp4' ? 256 * 1024 * 1024 : 20 * 1024 * 1024;
  const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'video/mp4': 'mp4' };
  const extension = Object.hasOwn(extensions, input.mimeType) ? extensions[input.mimeType] : undefined;
  if (!extension || !Number.isSafeInteger(input.byteLength) || input.byteLength < 12 || input.byteLength > limit)
    throw new Error('Invalid generated asset metadata');
  const requestRoot = await realpath(scope.requestRoot);
  const source = resolve(input.path);
  const local = relative(requestRoot, source);
  if (!local || isAbsolute(local) || local.split(sep).includes('..') || await realpath(source) !== source)
    throw new Error('Generated asset is outside its request directory');
  const root = resolve(scope.mediaRoot);
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (await realpath(root) !== root) throw new Error('Unsafe media root');
  const directory = join(root, 'generated', scope.orgId, scope.modelId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (await realpath(directory) !== directory) throw new Error('Unsafe asset directory');
  const fileName = `${randomUUID()}.${extension}`;
  const destination = join(directory, fileName);
  const reader = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let created = false;
  try {
    const before = await reader.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size !== input.byteLength)
      throw new Error('Generated asset changed before import');
    const writer = await open(destination, 'wx', 0o600);
    created = true;
    const hash = createHash('sha256');
    let copied = 0;
    try {
      const buffer = Buffer.alloc(64 * 1024);
      for (;;) {
        const { bytesRead } = await reader.read(buffer, 0, buffer.length, copied);
        if (!bytesRead) break;
        if (copied === 0) {
          const matches = input.mimeType === 'image/jpeg'
            ? buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
            : input.mimeType === 'image/png'
              ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              : buffer.toString('ascii', 4, 8) === 'ftyp';
          if (bytesRead < 12 || !matches) throw new Error('Generated asset type changed before import');
        }
        copied += bytesRead;
        if (copied > input.byteLength) throw new Error('Generated asset grew during import');
        hash.update(buffer.subarray(0, bytesRead));
        let written = 0;
        while (written < bytesRead) {
          const result = await writer.write(buffer, written, bytesRead - written);
          if (!result.bytesWritten) throw new Error('Asset write made no progress');
          written += result.bytesWritten;
        }
      }
      const after = await reader.stat();
      if (copied !== input.byteLength || after.size !== before.size
        || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
        throw new Error('Generated asset changed during import');
      await writer.sync();
    } finally { await writer.close(); }
    // Linux deployment requires directory-entry durability as well as file data.
    if (process.platform !== 'win32') {
      for (const entry of [directory, join(root, 'generated', scope.orgId), join(root, 'generated'), root]) {
        const handle = await open(entry, constants.O_RDONLY);
        try { await handle.sync(); } finally { await handle.close(); }
      }
    }
    return {
      storageKey: ['generated', scope.orgId, scope.modelId, fileName].join('/'),
      fileName, fileSize: copied, sha256: hash.digest(),
    };
  } catch (error) {
    if (created) await unlink(destination);
    throw error;
  } finally { await reader.close(); }
}
