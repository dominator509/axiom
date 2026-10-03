// Exercise audit-pnpm's narrow upstream exception with synthetic audit output.
// New high/critical advisories and package mismatches must still fail closed.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = mkdtempSync(join(tmpdir(), 'axiom-pnpm-audit-'));
try {
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'bin'));
  writeFileSync(
    join(root, 'scripts/audit-pnpm.mjs'),
    await (await import('node:fs/promises')).readFile(new URL('./audit-pnpm.mjs', import.meta.url)),
  );
  writeFileSync(join(root, 'scripts/test-patched-dependencies.mjs'), 'process.exit(0);\n');
  writeFileSync(
    join(root, 'scripts/check-braces-patch.mjs'),
    'process.exit(process.env.AUDIT_PATCH_FAILURE === "1" ? 1 : 0);\n',
  );
  writeFileSync(join(root, 'bin/pnpm'), '#!/bin/sh\ncat "$AUDIT_FIXTURE"\nexit 1\n', {
    mode: 0o755,
  });
  writeFileSync(join(root, 'bin/pnpm.cmd'), '@echo off\r\ntype "%AUDIT_FIXTURE%"\r\nexit /b 1\r\n');

  const run = (advisories, patchFailure = false) => {
    const file = join(root, 'audit.json');
    writeFileSync(file, JSON.stringify({ advisories }));
    const env = { ...process.env };
    const searchPath = process.env.PATH || process.env.Path;
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
    return spawnSync(process.execPath, [join(root, 'scripts/audit-pnpm.mjs')], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...env,
        PATH: `${join(root, 'bin')}${delimiter}${searchPath}`,
        AUDIT_FIXTURE: file,
        AUDIT_PATCH_FAILURE: patchFailure ? '1' : '0',
      },
    });
  };
  const nodeForge = {
    github_advisory_id: 'GHSA-86w9-cpqp-85rv',
    module_name: 'node-forge',
    severity: 'high',
  };
  const newAdvisory = {
    github_advisory_id: 'GHSA-new-example-1234',
    module_name: 'new-package',
    severity: 'high',
  };
  const wrongPackage = { ...nodeForge, module_name: 'other-package' };

  const accepted = run({ 1: nodeForge });
  assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
  assert.match(
    accepted.stdout,
    /accepted upstream limitation - GHSA-86w9-cpqp-85rv \(node-forge\)/,
  );
  assert.match(accepted.stdout, /digitalbazaar\/forge#1152/);

  const added = run({ 1: nodeForge, 2: newAdvisory });
  assert.equal(added.status, 1, 'A new high advisory must fail the audit gate');
  assert.match(added.stderr, /fail - GHSA-new-example-1234 \(new-package, high\)/);

  const mismatch = run({ 1: wrongPackage });
  assert.equal(mismatch.status, 1, 'The exception must not apply to a different package');
  assert.match(mismatch.stderr, /fail - GHSA-86w9-cpqp-85rv \(other-package, high\)/);

  const moderate = run({
    1: {
      ...nodeForge,
      github_advisory_id: 'GHSA-82fw-gwwq-j7x9',
      module_name: 'vitest',
      severity: 'moderate',
    },
  });
  assert.equal(
    moderate.status,
    0,
    'Existing moderate findings remain outside the high/critical gate',
  );

  const braces = {
    github_advisory_id: 'GHSA-vfj7-8cjw-p6xm',
    module_name: 'braces',
    severity: 'high',
  };
  const patched = run({ 1: braces });
  assert.equal(patched.status, 0, patched.stderr);
  assert.match(patched.stdout, /locally patched - GHSA-vfj7-8cjw-p6xm \(braces\)/);
  const missingPatch = run({ 1: braces }, true);
  assert.equal(missingPatch.status, 1);
  assert.match(missingPatch.stderr, /braces patch verification did not pass/);
  const patchMismatch = run({ 1: { ...braces, module_name: 'other-package' } });
  assert.equal(patchMismatch.status, 1);
  assert.match(patchMismatch.stderr, /fail - GHSA-vfj7-8cjw-p6xm \(other-package, high\)/);
  const critical = run({ 1: { ...newAdvisory, severity: 'critical' } });
  assert.equal(critical.status, 1);
  assert.match(critical.stderr, /new-package, critical/);

  console.log(
    'pnpm-audit: classification regressions 8 passed, 0 failed, 0 skipped (including failed patch verification and unknown high/critical findings)',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
