import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { grokSandboxCommand } from '../packages/llm-gateway/dist/providers/grok-sandbox.js';

assert.equal(process.argv[2], '--isolated-fixture');
assert.equal(process.platform, 'linux');
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const build = join(repo, 'infra/grok-cli/input-guard/target/debug');
const builtProbe = await realpath(join(build, 'examples/handoff_probe'));
const builtLauncher = await realpath(join(build, 'axiom-grok-image-launch'));
const parent = await realpath(tmpdir());
const fixture = await mkdtemp(join(parent, 'axiom-grok-handoff-'));
try {
  // A privileged hosted fixture cannot traverse the runner-owned checkout
  // after bubblewrap drops capabilities. Own only these synthetic executables
  // inside the fresh private fixture; never relax permissions on host homes.
  const executable = join(fixture, 'handoff-probe');
  const launcher = join(fixture, 'image-launcher');
  await copyFile(builtProbe, executable);
  await copyFile(builtLauncher, launcher);
  await chmod(executable, 0o500);
  await chmod(launcher, 0o500);
  const requestRoot = join(fixture, 'request');
  const credentialRoot = join(fixture, 'credentials');
  await mkdir(requestRoot, { mode: 0o700 });
  await mkdir(credentialRoot, { mode: 0o700 });
  const spec = grokSandboxCommand({ executable, requestRoot, credentialRoot, args: [],
    imageLauncher: { executable: launcher, byteLength: 128 } });
  for (const extraFd of [false, true]) {
    const child = spawnSync(spec.command, spec.args, { env: spec.env, input: Buffer.alloc(128, 0x42),
      stdio: extraFd ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
    if (child.status !== 0) {
      const mountFlags = spawnSync('/usr/bin/findmnt', ['--noheadings', '--output', 'VFS-OPTIONS', '--target', fixture],
        { encoding: 'utf8', timeout: 2000, maxBuffer: 4096 });
      console.error(`synthetic fixture VFS flags: ${(mountFlags.stdout ?? '').trim()}`);
      const identityArgs = spec.args.slice(0, spec.args.indexOf('--') + 1);
      const launcherMount = identityArgs.findIndex((arg, i) => arg === '--ro-bind' && identityArgs[i + 1] === launcher);
      identityArgs[launcherMount + 1] = '/usr/bin/id';
      identityArgs.push('/grok-input-launch');
      const identity = spawnSync(spec.command, identityArgs, { env: spec.env, encoding: 'utf8', timeout: 2000, maxBuffer: 4096 });
      console.error(`synthetic namespace identity: ${(identity.stdout ?? '').trim()} ${(identity.stderr ?? '').trim()}`);
    }
    // This fixture mounts only empty credentials and synthetic bytes. Include
    // bounded setup diagnostics so CI failures are actionable; production
    // provider stderr remains private.
    assert.equal(child.status, 0, `handoff probe failed (extra FD=${extraFd}, status=${child.status}): ${child.error?.message ?? ''} ${(child.stderr ?? '').slice(0, 2048)}`);
    assert.equal(child.stdout.trim(), 'sealed image handoff passed');
  }
  for (const size of [0, 12, 127, 129, 1024]) {
    const child = spawnSync(spec.command, spec.args, { env: spec.env, input: Buffer.alloc(size, 0x42),
      encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
    assert.notEqual(child.status, 0, 'incorrect transfer length reached the probe');
    assert.equal(child.stdout, '');
  }
  const missing = grokSandboxCommand({ executable, requestRoot, credentialRoot, args: ['missing'] });
  const missingChild = spawnSync(missing.command, missing.args, { env: missing.env, encoding: 'utf8', timeout: 10000 });
  assert.equal(missingChild.status, 0);
  assert.equal(missingChild.stdout.trim(), 'missing capability remains denied');
  const noTarget = [...spec.args];
  const targetMount = noTarget.findIndex((arg, i) => arg === '--ro-bind' && noTarget[i + 1] === executable);
  assert.ok(targetMount >= 0);
  noTarget.splice(targetMount, 3);
  const failedExec = spawnSync(spec.command, noTarget, { env: spec.env, input: Buffer.alloc(128, 0x42),
    encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
  assert.equal(failedExec.status, 1);
  assert.equal(failedExec.stdout, '');
  // A partial transfer must not exec the CLI. Killing the sandbox must also
  // close inherited output pipes, rather than leave a payload running.
  const stalled = spawn(spec.command, spec.args, { env: spec.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  stalled.stdout.on('data', chunk => { output += chunk; });
  stalled.stderr.resume();
  stalled.stdin.on('error', () => {});
  stalled.stdin.write(Buffer.alloc(12, 0x42));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { stalled.kill('SIGKILL'); reject(new Error('stalled launch did not close')); }, 3000);
    const cancel = setTimeout(() => stalled.kill('SIGKILL'), 200);
    stalled.once('error', reject);
    stalled.once('close', () => { clearTimeout(timeout); clearTimeout(cancel); resolve(); });
  });
  assert.equal(output, '');
  console.log('grok handoff: sealed stdin snapshot survived real bubblewrap/exec; descriptor reuse and child inheritance denied; truncated/oversized transfers rejected');
} finally {
  const resolved = await realpath(fixture);
  const local = relative(parent, resolved);
  assert.ok(local.startsWith('axiom-grok-handoff-') && !isAbsolute(local) && !local.includes('..'));
  await rm(resolved, { recursive: true, force: true });
}
