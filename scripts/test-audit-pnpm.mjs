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
  writeFileSync(join(root, 'bin/pnpm'), '#!/bin/sh\ncat "$AUDIT_FIXTURE"\nexit 1\n', {
    mode: 0o755,
  });

  const run = (advisories) => {
    const file = join(root, 'audit.json');
    writeFileSync(file, JSON.stringify({ advisories }));
    return spawnSync(process.execPath, [join(root, 'scripts/audit-pnpm.mjs')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH}`,
        AUDIT_FIXTURE: file,
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

  console.log(
    'pnpm-audit: allowlist regression passed (exact GHSA/package accepted; new high finding and package mismatch fail)',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
