// Read an existing content-hashed probe artifact, then exercise the real worker
// store and API preview implementation against a fresh private temporary root.
// No credentials, provider requests, database rows or approval decisions.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdtemp, open, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeGeneratedAsset } from '../packages/worker/dist/generated-asset-store.js';
import { assetPreview } from '../packages/api/dist/asset-preview.js';

const [mode, hash, extension] = process.argv.slice(2);
assert.equal(process.argv.length, 5);
assert.equal(mode, '--existing-probe');
assert.match(hash ?? '', /^[0-9a-f]{64}$/);
assert.ok(['jpg', 'png', 'mp4'].includes(extension));
const mimeType = { jpg: 'image/jpeg', png: 'image/png', mp4: 'video/mp4' }[extension];
const sourceRoot = fileURLToPath(new URL('../var/live-grok-probe', import.meta.url));
const path = join(sourceRoot, `${hash}.${extension}`);
assert.equal(await realpath(sourceRoot), sourceRoot);
assert.equal(await realpath(path), path);
const sourceFile = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
let source, originalStat;
try {
  originalStat = await sourceFile.stat();
  assert.ok(originalStat.isFile() && originalStat.nlink === 1);
  assert.ok(originalStat.size >= 12 && originalStat.size <= (extension === 'mp4' ? 256 : 20) * 1024 * 1024);
  source = await sourceFile.readFile();
  const after = await sourceFile.stat();
  assert.equal(after.mtimeMs, originalStat.mtimeMs);
  assert.equal(after.ctimeMs, originalStat.ctimeMs);
  assert.equal(source.length, originalStat.size);
  assert.equal(createHash('sha256').update(source).digest('hex'), hash);
} finally { await sourceFile.close(); }

const root = await mkdtemp(join(tmpdir(), 'axiom-generated-preview-'));
try {
  const results = [];
  for (const sanitizeMetadata of [false, true]) {
    const mediaRoot = join(root, sanitizeMetadata ? 'sanitized' : 'original');
    const stored = await storeGeneratedAsset({ path, mimeType, byteLength: source.length }, {
      orgId: randomUUID(), modelId: randomUUID(), requestRoot: sourceRoot, mediaRoot, sanitizeMetadata,
    });
    assert.equal(stored.mimeType, sanitizeMetadata && extension !== 'mp4' ? 'image/png' : mimeType);
    const asset = stored;
    const bytes = await readFile(join(mediaRoot, stored.storageKey));
    assert.equal(bytes.length, stored.fileSize);
    assert.ok(createHash('sha256').update(bytes).digest().equals(stored.sha256));
    if (!sanitizeMetadata) assert.deepEqual(bytes, source);
    const request = (method = 'GET', headers = {}) => new Request('http://127.0.0.1/media', { method, headers });
    const head = await assetPreview(asset, request('HEAD'), mediaRoot);
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(bytes.length));
    assert.equal(head.headers.get('content-type'), asset.mimeType);
    assert.equal(head.headers.get('cache-control'), 'private, no-store');
    assert.equal(head.headers.get('accept-ranges'), 'bytes');
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const full = await assetPreview(asset, request(), mediaRoot);
    assert.equal(full.status, 200);
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
    for (const [range, start, end] of [
      ['bytes=0-1', 0, 1], // Safari's initial MP4 range probe.
      ['bytes=-16', bytes.length - 16, bytes.length - 1],
      ['bytes=12-', 12, bytes.length - 1],
    ]) {
      const partial = await assetPreview(asset, request('GET', { range }), mediaRoot);
      assert.equal(partial.status, 206);
      assert.equal(partial.headers.get('content-range'), `bytes ${start}-${end}/${bytes.length}`);
      assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(start, end + 1));
    }
    const invalid = await assetPreview(asset, request('GET', { range: `bytes=${bytes.length}-` }), mediaRoot);
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get('content-range'), `bytes */${bytes.length}`);
    assert.equal((await invalid.arrayBuffer()).byteLength, 0);
    await assert.rejects(assetPreview({ ...asset, sha256: Buffer.alloc(32) }, request('HEAD'), mediaRoot));
    results.push({ sanitizeMetadata, mimeType: asset.mimeType, bytes: bytes.length,
      exactFileHashChanged: stored.exactFileHashChanged, headAndFullPreview: true, rangeRequests: 3,
      invalidRangeRejected: true, wrongHashRejected: true });
  }
  const after = await stat(path);
  assert.equal(after.size, originalStat.size);
  assert.equal(after.mtimeMs, originalStat.mtimeMs);
  assert.equal(after.ctimeMs, originalStat.ctimeMs);
  assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), hash);
  console.log(JSON.stringify({ sourceSha256: hash, results, originalUnchanged: true,
    providerRequests: 0, databaseWrites: 0, browserInteraction: false, approvalVerified: false }));
} finally {
  // Only our newly allocated temporary copies; original probe media is retained.
  await rm(root, { recursive: true, force: true });
}
