import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rehearsal = resolve(root, 'scripts/rehearse-pitr-recovery.mjs');
const safeEnv = {
  PATH: process.env.PATH ?? '',
  HOME: process.env.HOME ?? '',
  ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
};
const withoutOptIn = spawnSync(process.execPath, [rehearsal], {
  cwd: root, env: safeEnv, encoding: 'utf8', timeout: 10_000, windowsHide: true,
});
assert.equal(withoutOptIn.status, 2);
assert.match(withoutOptIn.stderr, /requires --isolated-fixture --tested-sha/);
assert.doesNotMatch(`${withoutOptIn.stdout}${withoutOptIn.stderr}`, /docker (?:run|pull|info)/i);

const head = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: root, env: safeEnv, encoding: 'utf8', timeout: 10_000, windowsHide: true,
});
assert.equal(head.status, 0);
const secretSentinel = 'recovery-fixture-secret-must-not-appear';
const withAmbientCredentials = spawnSync(process.execPath, [rehearsal, '--isolated-fixture', '--tested-sha', head.stdout.trim()], {
  cwd: root,
  env: { ...safeEnv, DATABASE_URL: 'postgresql://ambient.invalid/not-a-fixture', AXIOM_R2_SECRET_ACCESS_KEY: secretSentinel },
  encoding: 'utf8',
  timeout: 10_000,
  windowsHide: true,
});
assert.equal(withAmbientCredentials.status, 2);
assert.match(withAmbientCredentials.stderr, /refuses ambient database or cloud credentials/);
assert.doesNotMatch(`${withAmbientCredentials.stdout}${withAmbientCredentials.stderr}`, /ambient\.invalid|recovery-fixture-secret/);

console.log('recovery harness guards: 7 passed, 0 failed, 0 skipped; missing opt-in and ambient credential controls rejected before Docker');
