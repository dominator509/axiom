import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = mkdtempSync(join(tmpdir(), 'fanthynks-step-markers-'));
const cli = fileURLToPath(new URL('./step-markers.mjs', import.meta.url));
const marker = '.axiom/markers/L5.0/lbi-10.done';
const markerFile = join(root, marker);
const markerDigestFile = `${markerFile}.sha256`;
const spec = 'fixtures/acceptance.md';
const implementation = 'fixtures/implementation.txt';
const passed = [];
const failed = [];

function run(...args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
  });
}

function scenario(name, check) {
  try {
    check();
    passed.push(name);
  } catch (error) {
    failed.push(name);
    process.stderr.write(`${name}: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

try {
  mkdirSync(join(root, 'fixtures'), { recursive: true });
  writeFileSync(join(root, spec), 'LBI-10 requires valid markers to skip.\n');
  writeFileSync(join(root, implementation), 'original source\n');

  scenario('missing marker requests a run', () => {
    const result = run('check', '--root', root, '--marker', marker);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^RUN /);
  });

  scenario('valid marker skips and verify-all accepts it', () => {
    const write = run('write', '--root', root, '--marker', marker, '--step', 'LBI-10', '--input', spec, '--input', implementation);
    assert.equal(write.status, 0, write.stderr);
    const check = run('check', '--root', root, '--marker', marker);
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /^SKIP LBI-10/);
    const all = run('verify-all', '--root', root, '--directory', '.axiom/markers');
    assert.equal(all.status, 0, all.stderr);
    assert.match(all.stdout, /1 skipped, 0 run, 0 failed/);
  });

  scenario('source drift fails closed', () => {
    writeFileSync(join(root, implementation), 'changed source\n');
    const check = run('check', '--root', root, '--marker', marker);
    assert.notEqual(check.status, 0);
    assert.match(check.stdout, /^FAIL /);
    assert.match(check.stdout, /input checksum drift/);
    const all = run('verify-all', '--root', root, '--directory', '.axiom/markers');
    assert.notEqual(all.status, 0);
    assert.match(all.stdout, /0 skipped, 0 run, 1 failed/);
    writeFileSync(join(root, implementation), 'original source\n');
  });

  scenario('marker manifest edits fail its pinned checksum', () => {
    const original = readFileSync(markerFile);
    writeFileSync(markerFile, Buffer.concat([original, Buffer.from(' ')]));
    const check = run('check', '--root', root, '--marker', marker);
    assert.notEqual(check.status, 0);
    assert.match(check.stdout, /marker checksum drift/);
    writeFileSync(markerFile, original);
    assert.equal(run('check', '--root', root, '--marker', marker).status, 0);
  });

  scenario('checksum sidecar edits fail closed', () => {
    const original = readFileSync(markerDigestFile, 'utf8');
    writeFileSync(markerDigestFile, `sha256=${'0'.repeat(64)}\n`);
    const check = run('check', '--root', root, '--marker', marker);
    assert.notEqual(check.status, 0);
    assert.match(check.stdout, /marker checksum drift/);
    writeFileSync(markerDigestFile, original);
  });

  scenario('refresh is explicit after drift', () => {
    writeFileSync(join(root, implementation), 'new source revision\n');
    const accidental = run('write', '--root', root, '--marker', marker, '--step', 'LBI-10', '--input', spec, '--input', implementation);
    assert.notEqual(accidental.status, 0);
    assert.match(accidental.stdout, /already exists/);
    const refresh = run('write', '--refresh', '--root', root, '--marker', marker, '--step', 'LBI-10', '--input', spec, '--input', implementation);
    assert.equal(refresh.status, 0, refresh.stderr);
    const check = run('check', '--root', root, '--marker', marker);
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /^SKIP LBI-10/);
  });

  scenario('refresh cannot repurpose a completed step marker', () => {
    const result = run('write', '--refresh', '--root', root, '--marker', marker, '--step', 'OTHER-STEP', '--input', spec);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /cannot refresh a different or invalid step marker/);
    const check = run('check', '--root', root, '--marker', marker);
    assert.equal(check.status, 0, `${check.stdout} ${check.stderr}`);
    assert.match(check.stdout, /^SKIP LBI-10/);
  });

  scenario('marker paths cannot escape the repository root', () => {
    const result = run('write', '--root', root, '--marker', '../escape.done', '--step', 'LBI-10', '--input', spec);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /^FAIL /);
  });

  scenario('orphan checksum is rejected', () => {
    const orphan = join(root, '.axiom/markers/L5.0/orphan.done.sha256');
    writeFileSync(orphan, `sha256=${'0'.repeat(64)}\n`);
    const all = run('verify-all', '--root', root, '--directory', '.axiom/markers');
    assert.notEqual(all.status, 0);
    assert.match(all.stdout, /orphan checksum/);
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}

const cleanupVerified = !existsSync(root);
process.stdout.write(`step-markers: ${passed.length} passed, ${failed.length} failed, 0 skipped; cleanup=${cleanupVerified}\n`);
if (failed.length > 0 || !cleanupVerified) process.exitCode = 1;
