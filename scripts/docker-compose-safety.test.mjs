import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'axiom-compose-safety-'));
const emptyEnv = join(fixtureRoot, 'empty.env');
const fixtureEnv = join(fixtureRoot, 'fixture.env');
const composePath = 'infra/docker-compose.yml';
const fixturePostgresPassword = 'compose-test-only-postgres-value';
const fixturePgadminPassword = 'compose-test-only-pgadmin-value';

writeFileSync(emptyEnv, '');
writeFileSync(fixtureEnv,
  `AXIOM_DEV_POSTGRES_PASSWORD=${fixturePostgresPassword}\nAXIOM_DEV_PGADMIN_PASSWORD=${fixturePgadminPassword}\n`);

after(() => {
  assert.ok(basename(fixtureRoot).startsWith('axiom-compose-safety-'));
  assert.equal(dirname(fixtureRoot), tmpdir());
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function composeConfig(envFile, env = process.env) {
  return spawnSync('docker', [
    'compose', '--profile', 'tools', '--env-file', envFile, '-f', composePath, 'config', '--format', 'json',
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env,
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
}

test('development Compose refuses missing local database passwords', () => {
  const environmentWithoutComposePasswords = { ...process.env };
  delete environmentWithoutComposePasswords.AXIOM_DEV_POSTGRES_PASSWORD;
  delete environmentWithoutComposePasswords.AXIOM_DEV_PGADMIN_PASSWORD;
  const result = composeConfig(emptyEnv, environmentWithoutComposePasswords);
  const diagnostic = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0, 'Compose must reject an empty local credential environment');
  assert.match(diagnostic, /AXIOM_DEV_POSTGRES_PASSWORD/);
  assert.doesNotMatch(diagnostic, /changeme/);
});

test('development Compose keeps all published ports on loopback with supplied fixture credentials', () => {
  const result = composeConfig(fixtureEnv, {
    ...process.env,
    AXIOM_DEV_POSTGRES_PASSWORD: fixturePostgresPassword,
    AXIOM_DEV_PGADMIN_PASSWORD: fixturePgadminPassword,
  });
  assert.equal(result.status, 0, `Compose config failed: ${result.stderr}`);

  const config = JSON.parse(result.stdout);
  assert.equal(config.services.postgres.environment.POSTGRES_PASSWORD, fixturePostgresPassword);
  assert.equal(config.services.pgadmin.environment.PGADMIN_DEFAULT_PASSWORD, fixturePgadminPassword);

  for (const serviceName of ['postgres', 'pgadmin', 'media-plane', 'vision-engine', 'scraper']) {
    const ports = config.services[serviceName].ports;
    assert.ok(ports.length > 0, `${serviceName} must retain its expected host port mapping`);
    for (const port of ports) {
      assert.equal(port.host_ip, '127.0.0.1', `${serviceName} port ${port.target} must bind only to loopback`);
    }
  }
});
