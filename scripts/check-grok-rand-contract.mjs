// Bind standalone RNG regression coverage to the actual distributed lock patch.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const revision = '37949780c144e37df692e3d669051a21fec24f20';
const digest = '1a0e64a02260fc1d595b4e966d6e55b57e56f51479e1e06f7b44b206b3769053';
const expected = new Map([
  ['0.8.6', '5ca0ecfa931c29007047d1bc58e623ab12e5590e8c7cc53200d5202b69266d8a'],
  ['0.10.1', 'd2e8e8bcc7961af1fdac401278c6a831614941f6164ee3bf4ce61b7edb162207'],
]);
let base;
if (process.argv[2] === '--local-source' && process.argv.length === 4) {
  const source = resolve(process.argv[3]);
  base = execFileSync('git', ['-C', source, 'show', `${revision}:Cargo.lock`]);
} else {
  assert(process.argv[2] === '--fetch-upstream' && process.argv.length === 3,
    'Use --local-source PATH or explicitly allow --fetch-upstream');
  const response = await fetch(`https://raw.githubusercontent.com/xai-org/grok-build/${revision}/Cargo.lock`,
    { signal: AbortSignal.timeout(30_000), redirect: 'error' });
  assert(response.ok, `Pinned upstream lock fetch failed: ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    assert(size <= 1024 * 1024, 'Upstream lock exceeds bound');
    chunks.push(chunk);
  }
  base = Buffer.concat(chunks);
}
assert.equal(createHash('sha256').update(base).digest('hex'), digest,
  'Pinned upstream lock digest mismatch');
const patch = readFileSync(join(repo, 'infra/grok-cli/37949780-sealed-input-lock.patch'), 'utf8');
const harness = readFileSync(join(repo, 'infra/grok-cli/rand-regression/Cargo.lock'), 'utf8');
const fixture = mkdtempSync(join(tmpdir(), 'axiom-rand-contract-'));
const env = { ...process.env, GIT_INDEX_FILE: join(fixture, 'index') };
function git(args, input) {
  return execFileSync('git', ['-C', repo, ...args], {
    env, input, encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}
function reconstruct(candidatePatch) {
  assert.deepEqual(candidatePatch.split(/\r?\n/).filter(l => l.startsWith('diff --git ')),
    ['diff --git a/Cargo.lock b/Cargo.lock'], 'Unexpected file in lock patch');
  git(['read-tree', '--empty']);
  const blob = git(['hash-object', '-w', '--stdin'], base);
  git(['update-index', '--add', '--cacheinfo', `100644,${blob},Cargo.lock`]);
  git(['apply', '--cached', '--check', '--whitespace=error', '-'], candidatePatch);
  git(['apply', '--cached', '--whitespace=error', '-'], candidatePatch);
  return git(['show', ':Cargo.lock']);
}
function rngRecords(lock) {
  const records = new Map();
  for (const block of lock.replaceAll('\r', '').split('[[package]]\n').slice(1)) {
    if (!/^name = "rand"$/m.test(block)) continue;
    const version = /^version = "([^"]+)"$/m.exec(block)?.[1];
    const checksum = /^checksum = "([a-f0-9]{64})"$/m.exec(block)?.[1];
    assert(version && checksum && !records.has(version), 'Invalid or duplicate rand record');
    records.set(version, checksum);
  }
  return records;
}
function validate(lock, fixtureLock) {
  const production = rngRecords(lock), tested = rngRecords(fixtureLock);
  assert.deepEqual([...production.keys()].sort(), ['0.10.1', '0.8.6', '0.9.5']);
  assert.deepEqual([...tested.keys()].sort(), ['0.10.1', '0.8.6']);
  for (const [version, checksum] of expected) {
    assert.equal(production.get(version), checksum, 'Shipped RNG checksum mismatch');
    assert.equal(tested.get(version), checksum, 'Harness RNG checksum mismatch');
  }
}
try {
  const lock = reconstruct(patch);
  validate(lock, harness);
  // Same syntactically valid patch, but restore both vulnerable RNG records and
  // references. A passing standalone test must not make this regression green.
  let regressed = patch;
  for (const [oldVersion, newVersion, oldChecksum] of [
    ['0.8.5', '0.8.6', '34af8d1a0e25924bc5b7c43c079c942339d8f0a8b57c39049bef581b46327404'],
    ['0.10.0', '0.10.1', 'bc266eb313df6c5c09c1c7b1fbe2510961e5bcd3add930c1e31f7ed9da0feff8'],
  ]) {
    regressed = regressed.replaceAll(`rand ${newVersion}`, `rand ${oldVersion}`)
      .replaceAll(`+version = "${newVersion}"`, `+version = "${oldVersion}"`)
      .replaceAll(expected.get(newVersion), oldChecksum);
  }
  const oldLock = reconstruct(regressed);
  assert.throws(() => validate(oldLock, harness), 'Restored vulnerable patch must fail');
  assert.throws(() => validate(lock, harness.replace(expected.get('0.8.6'), '0'.repeat(64))),
    'Harness checksum drift must fail');
  console.log('Grok RNG shipped-lock contract: pass; reverted patch and harness drift rejected');
} finally {
  // Only the fresh private index is removed; caller index and worktree stay intact.
  rmSync(fixture, { recursive: true, force: true });
}
