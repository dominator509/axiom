// Local equivalent of the CI test setup. Never loads .env or uses recovered data.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
assert.equal(process.argv[2], '--isolated-fixture');
const focusedWorker = process.argv[3] === '--worker-media-failure';
const focusedVariants = process.argv[3] === '--variant-performance';
const focusedRetrieval = process.argv[3] === '--viral-retrieval';
const focusedColdRetrieval = process.argv[3] === '--viral-retrieval-cold';
const focusedPlaybook = process.argv[3] === '--playbook-history';
const focusedTeam = process.argv[3] === '--team-operations';
const focusedReadiness = process.argv[3] === '--database-readiness';
const focusedDigestStatus = process.argv[3] === '--digest-status';
const focusedViralEvidence = process.argv[3] === '--viral-evidence';
const focused = focusedWorker || focusedVariants || focusedRetrieval || focusedColdRetrieval || focusedPlaybook || focusedTeam || focusedDigestStatus || focusedViralEvidence;
assert.ok(process.argv.length === 3 || (process.argv.length === 4 && (focused || focusedReadiness)));
// Preserve the documented entry point, but never inspect or reuse the legacy
// container for readiness. The fresh catalog harness owns migration and cleanup.
if (focusedReadiness) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./rehearse-rls-catalog.mjs', import.meta.url)), '--isolated-fixture'],
    { stdio: 'inherit', windowsHide: true });
  process.exit(result.status ?? 1);
}
const coldRunId = randomBytes(8).toString('hex');
const container = focusedColdRetrieval ? `axiom-cold-retrieval-db-${coldRunId}` : 'axiom-ci-local-6cefdc1';
const network = `axiom-cold-retrieval-net-${coldRunId}`;
const postgresImage = 'timescale/timescaledb:2.29.2-pg16@sha256:289d55704b1b3ee8263cd3805c6930f9cd54506835a8f19f9b85dad17d5c5a8a';
const adminPassword = randomBytes(24).toString('hex');
const appPassword = focusedColdRetrieval ? randomBytes(24).toString('hex') : 'axiom_app';
let coldResourcesMayExist = false;
function docker(args, input, timeout = 60_000) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', windowsHide: true,
    timeout, maxBuffer: 1024 * 1024 });
  const message = args[0] === 'port' && result.status !== 0
    ? `Run-owned port lookup failed: ${result.stderr.trim()}`
    : args[0] === 'exec' && args[2] === 'createdb' && result.status !== 0
      ? `Run-owned fixture database creation failed: ${result.stderr.trim()}`
    : 'Isolated database command failed; diagnostics suppressed';
  assert.equal(result.status, 0, message);
  return result.stdout.trim();
}
const inspect = () => JSON.parse(docker(['inspect', '--format',
  '{"id":{{json .Id}},"running":{{json .State.Running}},"labels":{{json .Config.Labels}},"ports":{{json .NetworkSettings.Ports}}}', container]));
const inspectNetwork = () => JSON.parse(docker(['network', 'inspect', '--format',
  '{"id":{{json .Id}},"name":{{json .Name}},"labels":{{json .Labels}}}', network]));
function cleanupColdResources() {
  if (!focusedColdRetrieval || !coldResourcesMayExist) return;
  const containerIds = docker(['ps', '-aq', '--filter', `label=axiom.run_id=${coldRunId}`]).split(/\s+/).filter(Boolean);
  for (const id of containerIds) {
    const owned = JSON.parse(docker(['inspect', '--format',
      '{"name":{{json .Name}},"labels":{{json .Config.Labels}}}', id]));
    assert.equal(owned.name, `/${container}`);
    assert.equal(owned.labels['axiom.purpose'], 'isolated-cold-retrieval');
    assert.equal(owned.labels['axiom.run_id'], coldRunId);
    docker(['rm', '--force', id]);
  }
  const networkIds = docker(['network', 'ls', '-q', '--filter', `label=axiom.run_id=${coldRunId}`]).split(/\s+/).filter(Boolean);
  for (const id of networkIds) {
    const owned = JSON.parse(docker(['network', 'inspect', '--format',
      '{"name":{{json .Name}},"labels":{{json .Labels}}}', id]));
    assert.equal(owned.name, network);
    assert.equal(owned.labels['axiom.purpose'], 'isolated-cold-retrieval');
    assert.equal(owned.labels['axiom.run_id'], coldRunId);
    docker(['network', 'rm', id]);
  }
  assert.equal(docker(['ps', '-aq', '--filter', `label=axiom.run_id=${coldRunId}`]), '');
  assert.equal(docker(['network', 'ls', '-q', '--filter', `label=axiom.run_id=${coldRunId}`]), '');
  console.log(JSON.stringify({ removed_owned_cold_resources: true, containerCount: containerIds.length, networkCount: networkIds.length }));
}
async function waitForPostgres() {
  const deadline = Date.now() + 120_000;
  let consecutiveReady = 0;
  while (Date.now() < deadline) {
    const result = spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'axiom', '-d', 'axiom_test'], {
      encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024,
    });
    if (result.status === 0) {
      consecutiveReady++;
      if (consecutiveReady === 2) return;
    } else {
      consecutiveReady = 0;
    }
    if (result.error) throw new Error('Docker readiness probe could not run');
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error('Timed out waiting for the run-owned PostgreSQL container');
}
let hostPort = '55432';
let containerId = '';
try {
  if (focusedColdRetrieval) {
    const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    assert.ok(workflow.includes(`image: ${postgresImage}`), 'cold retrieval image must match the pinned CI PostgreSQL image');
    docker(['pull', postgresImage], undefined, 600_000);
    docker(['network', 'create', '--driver', 'bridge', '--label', 'axiom.purpose=isolated-cold-retrieval', '--label', `axiom.run_id=${coldRunId}`, network]);
    coldResourcesMayExist = true;
    containerId = docker(['create', '--name', container,
      '--label', 'axiom.purpose=isolated-cold-retrieval', '--label', `axiom.run_id=${coldRunId}`,
      '--network', network, '--publish', '127.0.0.1::5432',
      '--env', 'POSTGRES_USER=axiom', '--env', `POSTGRES_PASSWORD=${adminPassword}`, '--env', 'POSTGRES_DB=axiom_test',
      postgresImage], undefined, 600_000);
    docker(['start', container]);
    await waitForPostgres();
    const mapping = docker(['port', container, '5432/tcp']);
    const port = /^127\.0\.0\.1:(\d+)$/m.exec(mapping)?.[1];
    assert.ok(port, 'run-owned PostgreSQL must publish only on loopback');
    hostPort = port;
  }
const metadata = inspect();
assert.equal(metadata.running, true);
if (focusedColdRetrieval) {
  assert.equal(metadata.id, containerId);
  assert.equal(metadata.labels['axiom.purpose'], 'isolated-cold-retrieval');
  assert.equal(metadata.labels['axiom.run_id'], coldRunId);
  assert.deepEqual(metadata.ports['5432/tcp'], [{ HostIp: '127.0.0.1', HostPort: hostPort }]);
  const networkMetadata = inspectNetwork();
  assert.equal(networkMetadata.name, network);
  assert.equal(networkMetadata.labels['axiom.purpose'], 'isolated-cold-retrieval');
  assert.equal(networkMetadata.labels['axiom.run_id'], coldRunId);
} else {
  assert.equal(metadata.labels['axiom.purpose'], 'isolated-ci-validation');
  assert.deepEqual(metadata.ports['5432/tcp'], [{ HostIp: '127.0.0.1', HostPort: '55432' }]);
}
const database = `axiom_workspace_test_${randomBytes(8).toString('hex')}`;
const sql = input => docker(['exec', '-i', container, 'psql', '-X', '-w', '-q', '-t', '-A', '-1',
  '-U', 'axiom', '-d', database, '-v', 'ON_ERROR_STOP=1'], input);
let created = false;
try {
  docker(['exec', container, 'createdb', '-U', 'axiom', database]);
  created = true;
  const directory = new URL('../packages/db/migrations/', import.meta.url);
  const migrations = readdirSync(directory).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
  for (const file of migrations) {
    sql(readFileSync(new URL(file, directory), 'utf8').replace(/\r\n/g, '\n')
      .replace(/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;\s*$/gm, '')
      .replace(/TO axiom;/g, 'TO axiom_app;').replace(/TO axiom'/g, "TO axiom_app'"));
  }
  // Reuse the reviewed CI seed, but do not change the existing fixture role.
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const seed = workflow.match(/<<'SQL'\r?\n([\s\S]*?)\r?\n\s+SQL\r?\n/)?.[1];
  assert.ok(seed?.includes('CI Test Model'), 'CI seed not found');
  const seedSql = focusedColdRetrieval
    ? seed.replace("ALTER ROLE axiom_app WITH LOGIN PASSWORD 'axiom_app';", `ALTER ROLE axiom_app WITH LOGIN PASSWORD '${appPassword}';`)
    : seed.replace(/ALTER ROLE axiom_app WITH LOGIN PASSWORD 'axiom_app';/, '');
  sql(seedSql);
  assert.equal(sql("SELECT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls FROM pg_roles WHERE rolname='axiom_app';"), 't');
  const url = `postgresql://axiom_app:${appPassword}@127.0.0.1:${hostPort}/${database}`;
  const adminDatabaseUrl = `postgresql://axiom:${adminPassword}@127.0.0.1:${hostPort}/${database}`;
  console.log(JSON.stringify({ isolated_fixture: database, migrations: migrations.length, running_workspace_tests: true }));
  const command = focused ? process.execPath : process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : 'pnpm';
  const testFile = focusedViralEvidence ? 'packages/api/src/viral-evidence.integration.test.ts' : focusedDigestStatus ? 'packages/api/src/digest-schedule-status.integration.test.ts' : focusedTeam ? 'packages/api/src/routes/team-operations.integration.test.ts' : focusedPlaybook ? 'packages/api/src/routes/playbook-history.integration.test.ts' : focusedRetrieval || focusedColdRetrieval ? 'packages/worker/src/viral-retrieval.integration.test.ts' : focusedVariants ? 'packages/api/src/routes/variant-performance.integration.test.ts' : 'packages/worker/src/worker-media.integration.test.ts';
  const vitestOptions = focusedColdRetrieval
    ? { run: true, testNamePattern: 'controlled shared-buffer-cold retrieval' }
    : { run: true };
  const args = focused ? ['--input-type=module', '-e',
    `import{startVitest}from'vitest/node';const c=await startVitest('test',[${JSON.stringify(testFile)}],${JSON.stringify(vitestOptions)},{envFile:false});await c.close();`]
    // Windows runs real process-tree and media tests alongside Next/Metro builds.
    // Bound package-level contention, not the concurrency exercised by tests.
    : process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm.cmd run test --concurrency=2'] : ['test'];
  const code = await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: new URL('../', import.meta.url), stdio: 'inherit', windowsHide: true,
      env: { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url, API_ORIGIN: 'http://127.0.0.1:3001',
        AXIOM_ISOLATED_VALIDATION: '1', ...(focusedRetrieval ? { AXIOM_RETRIEVAL_PERFORMANCE: 'enabled' } : {}),
        ...(focusedColdRetrieval ? {
          AXIOM_RETRIEVAL_COLD_PERFORMANCE: 'enabled',
          AXIOM_RETRIEVAL_ADMIN_DATABASE_URL: adminDatabaseUrl,
          AXIOM_RETRIEVAL_CONTAINER_IMAGE: postgresImage,
        } : {}) } });
    child.on('error', reject);
    child.on('exit', code => resolve(code ?? 1));
  });
  process.exitCode = code;
} finally {
  if (created) {
    assert.match(database, /^axiom_workspace_test_[0-9a-f]{16}$/);
    assert.equal(inspect().id, metadata.id);
    docker(['exec', container, 'dropdb', '-U', 'axiom', database]);
    console.log(JSON.stringify({ removed_disposable_fixture: database, recovered_database_untouched: true }));
  }
}
} finally {
  cleanupColdResources();
}
