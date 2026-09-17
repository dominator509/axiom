import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { grokSandboxCommand } from '../packages/llm-gateway/dist/providers/grok-sandbox.js';

// Real production command builder and Linux namespace runtime; synthetic files
// only. No Grok account, provider request, or credentials are used by this probe.
assert.equal(process.argv[2], '--isolated-fixture');
assert.equal(process.platform, 'linux', 'Run this rehearsal on Linux');
const parent = await realpath(tmpdir());
const fixture = await mkdtemp(join(parent, 'axiom-cli-filesystem-'));
try {
  const requestRoot = join(fixture, 'request');
  const credentialRoot = join(fixture, 'credentials');
  const outside = join(fixture, 'other-user-image');
  await mkdir(requestRoot, { mode: 0o700 });
  await mkdir(credentialRoot, { mode: 0o700 });
  await writeFile(outside, 'synthetic private image');
  await writeFile(join(requestRoot, 'input'), 'authorized synthetic image');
  await writeFile(join(credentialRoot, 'auth.json'), '{}', { mode: 0o600 });
  await symlink(outside, join(requestRoot, 'escape'));
  const executable = await realpath(process.execPath);
  const probe = `
    const fs = require('node:fs');
    const canRead = path => { try { fs.readFileSync(path); return true; } catch { return false; } };
    const root = process.env.GROK_HOME;
    const auth = process.env.GROK_AUTH_PATH;
    fs.writeFileSync(auth + '.tmp', '{}', { mode: 0o600 });
    fs.renameSync(auth + '.tmp', auth);
    process.stdout.write(JSON.stringify({
      input: canRead(root + '/input'),
      outside: canRead(${JSON.stringify(outside)}),
      symlink: canRead(root + '/escape'),
      parentProcess: canRead(${JSON.stringify(`/proc/${process.pid}/root${outside}`)}),
      inheritedSecret: Boolean(process.env.AXIOM_FIXTURE_SECRET),
      credentialRefresh: canRead(auth),
    }));
  `;
  function run(command, args, env) {
    const child = spawnSync(command, args, { env, encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
    // No raw subprocess diagnostics or file contents are printed.
    assert.equal(child.status, 0, `Isolation probe failed (status=${child.status}, error=${child.error?.code ?? 'none'})`);
    return JSON.parse(child.stdout);
  }
  const baseline = run(executable, ['-e', probe], {
    GROK_HOME: requestRoot, GROK_AUTH_PATH: join(credentialRoot, 'auth.json'),
    AXIOM_FIXTURE_SECRET: 'synthetic-only',
  });
  assert.equal(baseline.outside, true);
  assert.equal(baseline.symlink, true);
  assert.equal(baseline.inheritedSecret, true);
  const sandbox = grokSandboxCommand({ executable, requestRoot, credentialRoot, args: ['-e', probe] });
  const isolated = run(sandbox.command, sandbox.args, sandbox.env);
  assert.deepEqual(isolated, {
    input: true, outside: false, symlink: false, parentProcess: false,
    inheritedSecret: false, credentialRefresh: true,
  });
  console.log('grok filesystem: baseline escape reproduced; isolated outside/symlink/proc/env access denied; authorized input and atomic credential replacement passed');
} finally {
  const resolved = await realpath(fixture);
  const local = relative(parent, resolved);
  assert.ok(local.startsWith('axiom-cli-filesystem-') && !isAbsolute(local) && !local.includes('..'));
  await rm(resolved, { recursive: true, force: true });
}
