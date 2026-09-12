// Exercise the actual launcher with disposable configuration and child scripts.
// No recovery configuration, credentials, database, or provider is accessed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

assert.deepEqual(process.argv.slice(2), ['--isolated-fixture']);
assert.equal(process.platform, 'linux', 'Launcher acceptance requires Linux');
assert.ok(Number(process.versions.node.split('.')[0]) >= 22);
const root = await mkdtemp(join(tmpdir(), 'axiom-startup-test-'));
try {
  for (const directory of ['scripts', 'var', 'packages/api/dist'])
    await mkdir(join(root, directory), { recursive: true });
  for (const file of ['start-local-grok-api.mjs', 'local-grok-origin.mjs'])
    await copyFile(new URL(file, import.meta.url), join(root, 'scripts', file));
  await writeFile(join(root, '.env'), 'DATABASE_URL=postgresql://127.0.0.1:35433/fixture\nBETTER_AUTH_SECRET=fixture-secret-never-forwarded-to-checker\n');
  await writeFile(join(root, 'var/grok-runtime.env'), [
    'AXIOM_GROK_CLI=/fixture/grok', 'AXIOM_GROK_VIDEO_CLI=/fixture/grok',
    'AXIOM_GROK_IMAGE_LAUNCHER=/fixture/launcher', '',
  ].join('\n'));
  await writeFile(join(root, 'packages/api/dist/server.js'), 'console.log("fixture-api-started");\n');
  const checker = join(root, 'scripts/check-local-grok-schema.mjs');
  const launch = () => spawnSync(process.execPath, [join(root, 'scripts/start-local-grok-api.mjs')], {
    cwd: root, env: {}, encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL',
  });
  for (const [name, body] of [
    ['incompatible schema', 'process.exit(1);'],
    ['checker signal', 'process.kill(process.pid, "SIGTERM");'],
    ['checker timeout', 'setInterval(() => {}, 1000);'],
    ['checker diagnostics', 'console.error("fixture-private-diagnostic"); process.exit(1);'],
  ]) {
    await writeFile(checker, body);
    const result = launch();
    assert.equal(result.error, undefined, `${name}: launcher must stop before the test deadline`);
    assert.equal(result.status, 1, name);
    assert.ok(!result.stdout.includes('fixture-api-started'), name);
    assert.ok(result.stderr.includes('Local API not started'), name);
    assert.ok(!result.stderr.includes('fixture-private-diagnostic'), name);
  }
  await rm(checker);
  const missing = launch();
  assert.equal(missing.status, 1);
  assert.ok(!missing.stdout.includes('fixture-api-started'));
  // The successful checker also verifies its argument and credential boundary.
  await writeFile(checker, `import assert from 'node:assert/strict';
assert.deepEqual(process.argv.slice(2), ['--read-only']);
assert.equal(process.env.DATABASE_URL, 'postgresql://127.0.0.1:35433/fixture');
assert.equal(process.env.BETTER_AUTH_SECRET, undefined);
`);
  const success = launch();
  assert.equal(success.error, undefined);
  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.stdout.trim(), 'fixture-api-started');
  console.log('local-grok-startup: 6 isolated process-boundary checks passed; no database or provider requests');
} finally {
  await rm(root, { recursive: true, force: true });
}
