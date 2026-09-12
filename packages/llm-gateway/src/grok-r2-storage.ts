import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants, closeSync, existsSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';

// Only provider-owned HTTPS endpoints; never arbitrary hosts, paths or URLs.
export const r2StorageSchema = z.object({
  endpoint: z.string().regex(/^https:\/\/[a-f0-9]{32}(?:\.(?:eu|us|fedramp))?\.r2\.cloudflarestorage\.com$/),
  bucket: z.string().min(3).max(63).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
  accessKeyId: z.string().regex(/^[a-fA-F0-9]{32}$/),
  secretAccessKey: z.string().regex(/^[a-fA-F0-9]{64}$/),
}).strict();
export type R2Storage = z.infer<typeof r2StorageSchema>;
export type R2Scope = { userId: string; orgId: string };

function identity(scope: R2Scope) {
  if (!scope.userId || !scope.orgId) throw new Error('Authenticated workspace required');
  return createHash('sha256').update(JSON.stringify([scope.orgId, scope.userId])).digest('hex');
}
function directory() {
  const path = join(resolve(process.env.AXIOM_SUBSCRIPTION_HOME || join(homedir(), '.axiom-subscriptions')), 'r2-storage');
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (realpathSync(path) !== path) throw new Error('Unsafe storage directory');
  return path;
}
function encryptionKey() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('Storage encryption is unavailable');
  // Domain-separated from session signing. Rotation requires re-entering keys.
  return createHash('sha256').update('axiom-grok-r2-v1\0').update(secret).digest();
}
function readEncrypted(path: string) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || info.size > 8192 || info.size < 29)
      throw new Error('Invalid storage record');
    return readFileSync(fd);
  } finally { closeSync(fd); }
}
export function loadR2Storage(scope: R2Scope): R2Storage | null {
  const id = identity(scope), path = join(directory(), `${id}.enc`);
  if (!existsSync(path)) return null;
  const bytes = readEncrypted(path);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(id)); decipher.setAuthTag(bytes.subarray(12, 28));
  const plaintext = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
  try { return r2StorageSchema.parse(JSON.parse(plaintext.toString('utf8'))); }
  finally { plaintext.fill(0); }
}
export function r2StorageStatus(scope: R2Scope) {
  const config = loadR2Storage(scope);
  return config ? { configured: true, endpoint: config.endpoint, bucket: config.bucket, verified: false }
    : { configured: false, verified: false };
}
export function saveR2Storage(scope: R2Scope, input: unknown) {
  const config = r2StorageSchema.parse(input), id = identity(scope), dir = directory();
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(), nonce);
  cipher.setAAD(Buffer.from(id));
  const plaintext = Buffer.from(JSON.stringify(config));
  let encrypted: Buffer;
  try { encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]); }
  finally { plaintext.fill(0); }
  const temporary = join(dir, `${id}.${randomUUID()}.tmp`), target = join(dir, `${id}.enc`);
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, Buffer.concat([nonce, cipher.getAuthTag(), encrypted])); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temporary, target);
    if (process.platform !== 'win32') {
      const parent = openSync(dir, constants.O_RDONLY);
      try { fsyncSync(parent); } finally { closeSync(parent); }
    }
  } finally { rmSync(temporary, { force: true }); }
  return { configured: true, endpoint: config.endpoint, bucket: config.bucket, verified: false };
}
export function removeR2Storage(scope: R2Scope) {
  rmSync(join(directory(), `${identity(scope)}.enc`), { force: true });
  return { configured: false, verified: false };
}
export function r2ManagedConfig(config: R2Storage, scope: R2Scope) {
  const checked = r2StorageSchema.parse(config);
  // Every interpolated value has a restricted alphabet; no TOML injection.
  return `[tools.zdr_video_output_s3]\nbucket = "${checked.bucket}"\nendpoint = "${checked.endpoint}"\nregion = "auto"\nkey_prefix = "axiom/${identity(scope)}/"\nexpires_secs = 900\n[tools.zdr_video_output_s3.read_write]\naccess_key_id = "${checked.accessKeyId}"\nsecret_access_key = "${checked.secretAccessKey}"\n`;
}
