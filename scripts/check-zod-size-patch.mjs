import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, basename, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const source = JSON.parse(readFileSync(new URL('../patches/zod-size-source.json', import.meta.url)));
const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'pnpm';
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'pnpm list zod -r --depth Infinity --json']
  : ['list', 'zod', '-r', '--depth', 'Infinity', '--json'];
const tree = spawnSync(command, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
assert.equal(tree.status, 0, 'Could not enumerate active Zod dependencies');
const paths = new Set();
function visit(node) {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, dependency] of Object.entries(node[field] || {})) {
      if (name === 'zod') paths.add(realpathSync(dependency.path));
      visit(dependency);
    }
  }
}
JSON.parse(tree.stdout).forEach(visit);
assert.ok(paths.size > 0, 'No active Zod installations found');
let backports = 0;
for (const directory of paths) {
  const version = JSON.parse(readFileSync(join(directory, 'package.json'))).version;
  if (version === '4.6.6') continue; // Exact upstream patched override, not audit-exempt.
  assert.equal(version, source.version, 'Unverified Zod version');
  for (const [file, expected] of Object.entries(source.files)) {
    const bytes = readFileSync(join(directory, file), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `Unverified Zod source: ${file}`);
  }
  const regression = spawnSync(process.execPath, ['scripts/test-zod-size-regression.mjs', directory], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  process.stdout.write(regression.stdout || '');
  process.stderr.write(regression.stderr || '');
  assert.equal(regression.status, 0, 'Zod size and compatibility regressions failed');
  // Demonstrate that the checks reject the original vulnerable implementation.
  const temporary = mkdtempSync(join(tmpdir(), 'axiom-zod-negative-'));
  try {
    cpSync(directory, temporary, { recursive: true });
    const reverted = spawnSync('git', ['apply', '--reverse', resolve('patches/zod@3.25.76.patch')], {
      cwd: temporary, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(reverted.status, 0, 'Could not prepare unpatched Zod negative control');
    const negative = spawnSync(process.execPath, [resolve('scripts/test-zod-size-regression.mjs'), temporary], {
      encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
    });
    assert.equal(negative.status, 1, 'Unpatched Zod was not rejected');
    assert.match(negative.stderr, /Oversized input walked elements|Element refinement ran before upper bound rejection/);
  } finally {
    const owned = realpathSync(temporary);
    assert.ok(owned.startsWith(realpathSync(tmpdir()) + sep) && basename(owned).startsWith('axiom-zod-negative-'));
    rmSync(owned, { recursive: true, force: true });
  }
  backports++;
}
assert.ok(backports > 0, 'No verified v3 backport; audit recognition unavailable');
console.log(`zod-size-patch: verified ${backports} active backport(s); original-source negative controls rejected; temporary copies removed`);
