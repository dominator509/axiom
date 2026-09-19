// Exercise Docker's actual ignore matcher using synthetic files only.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

assert.equal(process.argv[2], '--isolated-fixture');
const root = mkdtempSync(join(tmpdir(), 'axiom-context-check-'));
const context = join(root, 'input');
const output = join(root, 'output');
const excluded = ['.env', '.env.local', 'packages/api/.env', 'packages/api/.env.production',
  'var/runtime.env', 'var/oauth/credentials.json', 'packages/worker/var/private.json',
  '.next-rehearsal/server.js', 'packages/dashboard/.next-rehearsal/server.js'];
const included = ['.env.example', 'packages/api/.env.example', 'packages/api/src/index.ts', 'Cargo.lock'];
try {
  mkdirSync(context);
  writeFileSync(join(context, '.dockerignore'), readFileSync(new URL('../.dockerignore', import.meta.url)));
  writeFileSync(join(context, 'Dockerfile'), 'FROM scratch\nCOPY . /context/\n');
  for (const path of [...excluded, ...included]) {
    mkdirSync(dirname(join(context, path)), { recursive: true });
    writeFileSync(join(context, path), 'synthetic-context-fixture\n');
  }
  const built = spawnSync('docker', ['build', '--output', `type=local,dest=${output}`, context], {
    encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 1024 * 1024,
  });
  assert.equal(built.status, 0, 'Synthetic scratch context build must succeed (diagnostics suppressed)');
  for (const path of excluded) assert.equal(existsSync(join(output, 'context', path)), false,
    `Private/runtime path must be excluded: ${path}`);
  for (const path of included) assert.equal(existsSync(join(output, 'context', path)), true,
    `Required source/example path must remain: ${path}`);
  console.log('Docker context: real ignore matcher excludes runtime credentials and rehearsal output; sources/examples retained');
} finally {
  assert.ok(basename(root).startsWith('axiom-context-check-'));
  assert.equal(dirname(root), tmpdir());
  rmSync(root, { recursive: true, force: true });
}
