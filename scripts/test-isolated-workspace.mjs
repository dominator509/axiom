// Local equivalent of the CI test setup. Never loads .env or uses recovered data.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
assert.equal(process.argv[2], '--isolated-fixture');
const container = 'axiom-ci-local-6cefdc1';
function docker(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', windowsHide: true,
    timeout: 60_000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, 'Isolated database command failed; diagnostics suppressed');
  return result.stdout.trim();
}
const inspect = () => JSON.parse(docker(['inspect', '--format',
  '{"id":{{json .Id}},"running":{{json .State.Running}},"labels":{{json .Config.Labels}},"ports":{{json .NetworkSettings.Ports}}}', container]));
const metadata = inspect();
assert.equal(metadata.running, true);
assert.equal(metadata.labels['axiom.purpose'], 'isolated-ci-validation');
assert.deepEqual(metadata.ports['5432/tcp'], [{ HostIp: '127.0.0.1', HostPort: '55432' }]);
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
  sql(seed.replace(/ALTER ROLE axiom_app WITH LOGIN PASSWORD 'axiom_app';/, ''));
  assert.equal(sql("SELECT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls FROM pg_roles WHERE rolname='axiom_app';"), 't');
  const url = `postgresql://axiom_app:axiom_app@127.0.0.1:55432/${database}`;
  console.log(JSON.stringify({ isolated_fixture: database, migrations: migrations.length, running_workspace_tests: true }));
  const command = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : 'pnpm';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm.cmd test'] : ['test'];
  const code = await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: new URL('../', import.meta.url), stdio: 'inherit', windowsHide: true,
      env: { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url, API_ORIGIN: 'http://127.0.0.1:3001' } });
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
