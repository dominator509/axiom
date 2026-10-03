// Audit recognition requires the pinned implementation in every active dependency path.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = JSON.parse(
  readFileSync(new URL('../patches/braces-security-source.json', import.meta.url)),
);
const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'pnpm';
const args =
  process.platform === 'win32'
    ? ['/d', '/s', '/c', 'pnpm list braces -r --depth Infinity --json']
    : ['list', 'braces', '-r', '--depth', 'Infinity', '--json'];
const tree = spawnSync(command, args, {
  encoding: 'utf8',
  timeout: 60_000,
  maxBuffer: 16 * 1024 * 1024,
});
assert.equal(tree.status, 0, 'Could not enumerate active braces dependencies');
const roots = JSON.parse(tree.stdout);
assert.ok(Array.isArray(roots), 'Invalid dependency tree');
const paths = new Set();
function visit(node) {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, dependency] of Object.entries(node[field] || {})) {
      if (name === 'braces') {
        assert.equal(dependency.version, source.version, 'Unverified braces version');
        paths.add(realpathSync(dependency.path));
      }
      visit(dependency);
    }
  }
}
roots.forEach(visit);
assert.ok(paths.size > 0, 'No braces installation found; audit recognition cannot be verified');
for (const directory of paths) {
  assert.equal(JSON.parse(readFileSync(join(directory, 'package.json'))).version, source.version);
  for (const [file, expected] of Object.entries(source.files)) {
    const content = readFileSync(join(directory, file), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(
      createHash('sha256').update(content).digest('hex'),
      expected,
      `Unverified braces implementation: ${file}`,
    );
  }
  const result = spawnSync(process.execPath, ['scripts/test-braces-regression.cjs', directory], {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  assert.equal(result.status, 0, 'Braces security and compatibility regressions failed');
}
console.log(
  `braces-patch: verified ${paths.size} active installation(s), upstream ${source.commit}`,
);
