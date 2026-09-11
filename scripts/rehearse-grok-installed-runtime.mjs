// Offline smoke of the actual installed CLI, including sealed FD transfer.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { grokSandboxCommand } from '../packages/llm-gateway/dist/providers/grok-sandbox.js';

const [executable, launcher] = process.argv.slice(2);
assert(executable && launcher, 'Provide installed CLI and launcher paths');
const root = mkdtempSync(join(tmpdir(), 'axiom-installed-smoke-'));
try {
  const credentials = join(root, 'empty-credentials');
  mkdirSync(credentials, { mode: 0o700 });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1kAAAAASUVORK5CYII=', 'base64');
  for (const sealed of [false, true]) {
    const requestRoot = join(root, sealed ? 'sealed' : 'plain');
    mkdirSync(requestRoot, { mode: 0o700 });
    const spec = grokSandboxCommand({ executable, requestRoot, credentialRoot: credentials,
      args: ['--version'], ...(sealed ? { imageLauncher: { executable: launcher, byteLength: png.length } } : {}) });
    const result = spawnSync(spec.command, ['--unshare-net', ...spec.args], {
      cwd: spec.cwd, env: spec.env, input: sealed ? png : undefined,
      timeout: 15_000, maxBuffer: 16_384, encoding: 'utf8',
    });
    assert.equal(result.status, 0, `Offline installed runtime failed: ${result.error?.message ?? result.stderr}`);
    assert.match(result.stdout, /grok 1\.0\.24/);
    console.log(`${sealed ? 'sealed launcher + CLI' : 'CLI'}: offline sandbox version smoke passed`);
  }
} finally {
  // This fresh fixture contains only our synthetic image and empty directories.
  rmSync(root, { recursive: true, force: true });
}
