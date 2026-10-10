// Exercise the real shell gate with controlled command fixtures, without network.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = mkdtempSync(join(tmpdir(), 'axiom-security-gate-'));
const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
try {
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'scripts/security-check.sh'), readFileSync(new URL('./security-check.sh', import.meta.url)));
  writeFileSync(join(root, '.gitignore'), '.env\n');
  writeFileSync(join(root, '.env.example'), 'PASSWORD=replace-me\n');
  writeFileSync(join(root, 'Cargo.lock'), '# Controlled fixture\n');
  const git = args => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, `Could not prepare isolated scanner repository (${args.join(' ')}): ${result.stderr}`);
  };
  git(['init', '--quiet']);
  git(['add', '.env.example', '.gitignore', 'Cargo.lock', 'scripts/security-check.sh']);
  const commands = {
    node: 'exit 0', pnpm: 'exit 0', 'cargo-audit': 'exit 0',
    cargo: 'if [ "$AUDIT_TEST_ERROR" = 1 ]; then echo "error: registry check timed out" >&2; fi\nexit 0',
  };
  for (const [name, body] of Object.entries(commands))
    writeFileSync(join(root, 'bin', name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  let casesPassed = 0;
  for (const [error, secret, expected] of [['0', '0', 0], ['1', '0', 1], ['0', '1', 1]]) {
    if (secret === '1') {
      writeFileSync(join(root, 'fixture.ts'), 'TOKEN=synthetic_not_a_real_credential\n');
      git(['add', 'fixture.ts']);
    }
    const result = spawnSync(bash, [join(root, 'scripts/security-check.sh')], {
      encoding: 'utf8', windowsHide: true, timeout: 15_000,
      env: { ...process.env, PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH}`,
        AUDIT_TEST_ERROR: error, AUDIT_TEST_SECRET: secret },
    });
    assert.equal(result.status, expected, `Unexpected security gate status (error=${error}, secret=${secret})`);
    assert.ok(!result.stdout.includes('synthetic_not_a_real_credential'), 'Scanner exposed matched content');
    if (error === '1') assert.ok(result.stdout.includes('could not complete all registry checks'));
    if (secret === '1') assert.ok(result.stdout.includes('fixture.ts'));
    casesPassed++;
  }
  git(['rm', '--quiet', '--force', '--', 'fixture.ts']);
  const exampleSecret = 'synthetic_env_example_secret_value_never_real';
  writeFileSync(join(root, '.env.example'), `PASSWORD=${exampleSecret}\n`);
  const exampleResult = spawnSync(bash, [join(root, 'scripts/security-check.sh')], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000,
    env: { ...process.env, PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH}`,
      AUDIT_TEST_ERROR: '0', AUDIT_TEST_SECRET: '0' },
  });
  assert.equal(exampleResult.status, 1, 'A secret-like value in .env.example must fail closed');
  assert.ok(exampleResult.stdout.includes('.env.example'), 'Secret finding should report the template filename only');
  assert.ok(!exampleResult.stdout.includes(exampleSecret), 'The scanner exposed .env.example contents');
  casesPassed++;
  for (const [fileName, secret] of [
    ['.env', 'synthetic_env_file_secret_value_never_real'],
    ['packages/api/.env.production', 'synthetic_nested_env_secret_value_never_real'],
  ]) {
    if (fileName.includes('/')) mkdirSync(join(root, 'packages', 'api'), { recursive: true });
    writeFileSync(join(root, fileName), `PASSWORD=${secret}\n`);
    git(['add', '--force', '--', fileName]);
    const envResult = spawnSync(bash, [join(root, 'scripts/security-check.sh')], {
      encoding: 'utf8', windowsHide: true, timeout: 15_000,
      env: { ...process.env, PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH}`,
        AUDIT_TEST_ERROR: '0', AUDIT_TEST_SECRET: '0' },
    });
    assert.equal(envResult.status, 1, `Tracked environment file ${fileName} must fail closed`);
    assert.ok(envResult.stdout.includes(fileName), `Tracked environment-file finding should report only ${fileName}`);
    assert.ok(!envResult.stdout.includes(secret), 'The scanner exposed tracked environment-file contents');
    git(['rm', '--quiet', '--force', '--', fileName]);
    casesPassed++;
  }
  assert.equal(casesPassed, 6);
  console.log(`security-gate: ${casesPassed} passed, 0 failed, 0 skipped (clean, audit error, source secret, env template secret, .env and nested env file)`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
