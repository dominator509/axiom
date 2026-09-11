// Verify the distributed patch set without changing the upstream checkout/index.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.argv[2], '--isolated-fixture', 'Explicit --isolated-fixture required');
const repo = fileURLToPath(new URL('../', import.meta.url));
const source = join(repo, 'var/grok-source-37949780');
const base = '37949780c144e37df692e3d669051a21fec24f20';
const patches = ['sealed-input', 'sealed-input-lock', 'bounded-image', 'aws-lc'];
const fixture = mkdtempSync(join(tmpdir(), 'axiom-grok-patchset-'));
const env = { ...process.env, GIT_INDEX_FILE: join(fixture, 'index') };
function git(...args) {
  return execFileSync('git', ['-C', source, ...args], {
    env, encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
try {
  assert.equal(git('rev-parse', 'HEAD'), base, 'Wrong upstream source revision');
  git('read-tree', base);
  for (const name of patches) {
    const patch = resolve(repo, `infra/grok-cli/37949780-${name}.patch`);
    git('apply', '--cached', '--check', '--whitespace=error', patch);
    git('apply', '--cached', '--whitespace=error', patch);
  }
  const paths = git('diff', '--cached', '--name-only', base).split('\n');
  assert(paths.length > 0);
  for (const path of paths) {
    // Apply the same Git clean filters used for upstream blobs.
    const expected = git('rev-parse', `:${path}`);
    const actual = git('hash-object', `--path=${path}`, path);
    assert.equal(actual, expected, `Candidate differs from packaged patches: ${path}`);
  }
  console.log(JSON.stringify({ upstream: base, patches: patches.length,
    matchingCandidateFiles: paths.length, originalIndexUntouched: true }));
} finally {
  // Only this invocation's fresh temporary index is removed.
  rmSync(fixture, { recursive: true, force: true });
}
