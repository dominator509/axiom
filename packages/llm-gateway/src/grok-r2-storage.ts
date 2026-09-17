import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
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
  // Pinned Grok prepare_video_gen_config drops S3 settings unless this flag
  // is true. A ZDR account alone does not enable the CLI's upload path.
  return `[tools]\ndisable_zdr_incompatible_tools = true\n[tools.zdr_video_output_s3]\nbucket = "${checked.bucket}"\nendpoint = "${checked.endpoint}"\nregion = "auto"\nkey_prefix = "axiom/${identity(scope)}/"\nexpires_secs = 900\n[tools.zdr_video_output_s3.read_write]\naccess_key_id = "${checked.accessKeyId}"\nsecret_access_key = "${checked.secretAccessKey}"\n`;
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function signingKey(secret: string, date: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), 'auto'), 's3'), 'aws4_request');
}

function encodedPath(bucket: string, objectKey: string): string {
  return `/${[bucket, ...objectKey.split('/')].map(segment => encodeURIComponent(segment)).join('/')}`;
}

async function signedR2Request(config: R2Storage, method: 'PUT' | 'GET' | 'DELETE', objectKey: string, body = Buffer.alloc(0)): Promise<Response> {
  const endpoint = new URL(config.endpoint);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const shortDate = amzDate.slice(0, 8);
  const payloadHash = createHash('sha256').update(body).digest('hex');
  const host = endpoint.hostname;
  const uri = encodedPath(config.bucket, objectKey);
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, uri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${shortDate}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const signature = createHmac('sha256', signingKey(config.secretAccessKey, shortDate)).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return fetch(new URL(uri, endpoint).toString(), {
    method,
    headers: {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: authorization,
      ...(method === 'PUT' ? { 'content-type': 'text/plain; charset=utf-8', 'content-length': String(body.byteLength) } : {}),
    },
    body: method === 'GET' || method === 'DELETE' ? undefined : body,
    signal: AbortSignal.timeout(10_000),
  });
}

/** Prove private R2 read/write access with a tenant-scoped temporary object. */
export async function verifyR2Storage(scope: R2Scope): Promise<{ configured: true; verified: true }> {
  const config = loadR2Storage(scope);
  if (!config) throw new Error('R2 storage is not configured');
  const objectKey = `axiom-verification/${identity(scope)}/${randomUUID()}.txt`;
  const probe = Buffer.from('FanThynks private storage verification\n', 'utf8');
  let uploaded = false;
  try {
    const put = await signedR2Request(config, 'PUT', objectKey, probe);
    if (!put.ok) throw new Error(`PUT returned HTTP ${put.status}`);
    uploaded = true;
    const get = await signedR2Request(config, 'GET', objectKey);
    if (!get.ok) throw new Error(`GET returned HTTP ${get.status}`);
    if (!Buffer.from(await get.arrayBuffer()).equals(probe)) throw new Error('GET returned unexpected probe bytes');
    return { configured: true, verified: true };
  } catch (error) {
    throw new Error(`R2 verification failed: ${error instanceof Error ? error.message : 'provider request failed'}`);
  } finally {
    if (uploaded) {
      try { await signedR2Request(config, 'DELETE', objectKey); } catch { /* best-effort cleanup */ }
    }
  }
}
