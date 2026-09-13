// Exercise the actual launcher with disposable configuration and child scripts.
// No recovery configuration, credentials, database, or provider is accessed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

assert.deepEqual(process.argv.slice(2), ['--isolated-fixture']);
assert.equal(process.platform, 'linux', 'Launcher acceptance requires Linux');
assert.ok(Number(process.versions.node.split('.')[0]) >= 22);
const root = await mkdtemp(join(tmpdir(), 'axiom-startup-test-'));
try {
  for (const directory of ['scripts', 'var', 'bin', 'packages/api/dist'])
    await mkdir(join(root, directory), { recursive: true });
  for (const file of ['start-local-grok-api.mjs', 'local-grok-origin.mjs'])
    await copyFile(new URL(file, import.meta.url), join(root, 'scripts', file));
  const fixtureSecret = 'fixture-secret-never-forwarded-to-checker';
  const writeEnv = secret => writeFile(join(root, '.env'),
    `DATABASE_URL=postgresql://127.0.0.1:35433/fixture\n${secret === undefined ? '' : `BETTER_AUTH_SECRET=${JSON.stringify(secret)}\n`}`);
  await writeEnv(fixtureSecret);
  const runtime = {
    AXIOM_GROK_CLI: join(root, 'bin/grok'),
    AXIOM_GROK_VIDEO_CLI: join(root, 'bin/video'),
    AXIOM_GROK_IMAGE_LAUNCHER: join(root, 'bin/launcher'),
  };
  for (const path of Object.values(runtime))
    await writeFile(path, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const writeRuntime = values => writeFile(join(root, 'var/grok-runtime.env'),
    Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n'));
  await writeRuntime(runtime);
  await writeFile(join(root, 'packages/api/dist/server.js'), `
if (process.env.BETTER_AUTH_SECRET !== ${JSON.stringify(fixtureSecret)}) process.exit(2);
console.log("fixture-api-started");\n`);
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
  // Repeat startup to prove the same configured signing/encryption key survives.
  const restart = launch();
  assert.equal(restart.status, 0);
  assert.equal(restart.stdout.trim(), 'fixture-api-started');
  // Neither a schema query nor API startup should happen for invalid local
  // configuration. This marker checker would expose incorrect guard ordering.
  const unexpectedCheck = join(root, 'unexpected-schema-check');
  await writeFile(checker, `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(unexpectedCheck)}, 'unexpected');`);
  for (const secret of [undefined, '', 'too-short', ' '.repeat(40)]) {
    await writeEnv(secret);
    const rejected = launch();
    assert.equal(rejected.status, 1, 'Missing or weak persistent secret must fail startup');
    assert.ok(rejected.stderr.includes('BETTER_AUTH_SECRET must be a persistent'),
      'Missing persistent secret must produce an actionable, value-free error');
    assert.ok(!rejected.stdout.includes('fixture-api-started'));
    assert.ok(!rejected.stderr.includes('too-short'));
    assert.equal(existsSync(unexpectedCheck), false, 'Configuration must be checked before database access');
  }
  await writeEnv(fixtureSecret);
  for (const key of Object.keys(runtime)) {
    for (const path of ['relative/grok', join(root, 'bin/missing'), join(root, 'bin')]) {
      await writeRuntime({ ...runtime, [key]: path });
      const rejected = launch();
      assert.equal(rejected.status, 1);
      assert.ok(rejected.stderr.includes(`${key} must name an executable regular file`));
      assert.ok(!rejected.stdout.includes('fixture-api-started'));
      assert.ok(!rejected.stderr.includes(path), 'Do not expose configured path values');
      assert.equal(existsSync(unexpectedCheck), false);
    }
    await writeRuntime(runtime);
    await chmod(runtime[key], 0o600);
    const rejected = launch();
    assert.equal(rejected.status, 1);
    assert.ok(rejected.stderr.includes(`${key} must name an executable regular file`));
    assert.equal(existsSync(unexpectedCheck), false);
    await chmod(runtime[key], 0o700);
  }
  console.log('local-grok-startup: 23 isolated process-boundary checks passed; persistent key and executable guards verified; no database or provider requests');
} finally {
  await rm(root, { recursive: true, force: true });
}
