import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

// Contract probe only: a fresh expired synthetic store, not a real login.
assert.equal(process.argv[2], '--isolated-fixture');
const parent = await realpath(tmpdir());
const fixture = await mkdtemp(join(parent, 'axiom-grok-auth-path-'));
try {
  const credentials = join(fixture, 'credentials');
  await mkdir(credentials, { mode: 0o700 });
  const selected = join(credentials, 'auth.json');
  const legacy = join(fixture, 'auth.json');
  const synthetic = JSON.stringify({
    'https://accounts.x.ai/sign-in': { key: 'not-a-real-token', auth_mode: 'oidc',
      create_time: '2020-01-01T00:00:00Z', user_id: 'isolated-fixture',
      oidc_issuer: 'https://auth.x.ai' },
  });
  await writeFile(selected, synthetic, { mode: 0o600 });
  await writeFile(legacy, synthetic, { mode: 0o600 });
  await utimes(selected, 1, 1);
  await utimes(legacy, 1, 1);
  const env = { GROK_HOME: fixture, GROK_AUTH_PATH: selected, GROK_DISABLE_AUTOUPDATER: '1', CI: '1' };
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'Path', 'TEMP', 'TMP']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  const executable = join(homedir(), '.grok', 'bin', process.platform === 'win32' ? 'grok.exe' : 'grok');
  const child = spawnSync(executable, ['logout'], { env, cwd: fixture, encoding: 'utf8', timeout: 10000, maxBuffer: 65536, windowsHide: true });
  assert.equal(child.status, 0, `CLI auth-path probe failed (status=${child.status})`);
  assert.ok(!existsSync(selected) || (await stat(selected)).mtimeMs > 1000,
    `CLI did not update selected store; legacy changed=${!existsSync(legacy) || (await stat(legacy)).mtimeMs > 1000}`);
  assert.equal(existsSync(legacy), true, 'CLI modified the legacy credential location');
  assert.equal((await stat(legacy)).mtimeMs, 1000);
  console.log('grok auth path: actual CLI logout selected GROK_AUTH_PATH, legacy synthetic store untouched; live OAuth refresh not tested');
} finally {
  const resolved = await realpath(fixture);
  const local = relative(parent, resolved);
  assert.ok(local.startsWith('axiom-grok-auth-path-') && !isAbsolute(local) && !local.includes('..'));
  await rm(resolved, { recursive: true, force: true });
}
