import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

// Real PostgreSQL fault injection, restricted to a fresh database in the
// labeled agent-owned fixture. Never reads or modifies axiom-postgres.
assert.equal(process.argv[2], '--isolated-fixture', 'Pass --isolated-fixture explicitly');
const container = 'axiom-ci-local-6cefdc1';
const database = `axiom_migrate_${randomBytes(8).toString('hex')}`;
function invoke(args, input) {
  return spawnSync('docker', args, {
    input, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  });
}
function docker(args, input) {
  const result = invoke(args, input);
  assert.equal(result.status, 0, 'Isolated migration command failed (output suppressed)');
  return result.stdout.trim();
}
const exec = (...args) => docker(['exec', container, ...args]);
const sql = statement => exec('psql', '-X', '-q', '-U', 'axiom', '-d', database,
  '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', statement);
const metadata = JSON.parse(docker(['inspect', container]))[0];
assert.equal(metadata.Config.Labels?.['axiom.purpose'], 'isolated-ci-validation');
assert.equal(metadata.State.Running, true);
const runner = readFileSync(new URL('./migrate.sh', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const migration = 'BEGIN;\nCREATE TABLE atomicity_probe (id integer);\nINSERT INTO atomicity_probe VALUES (1);\nCOMMIT;\n';
let directory;
let created = false;
try {
  directory = exec('mktemp', '-d', '/tmp/axiom-migrate.XXXXXXXX');
  assert.match(directory, /^\/tmp\/axiom-migrate\.[A-Za-z0-9]+$/);
  exec('mkdir', '-p', `${directory}/scripts`, `${directory}/packages/db/migrations`);
  const put = (path, content) => docker(['exec', '-i', container, 'tee', `${directory}/${path}`], content);
  put('scripts/migrate.sh', runner);
  put('packages/db/migrations/0000_probe.sql', migration);
  exec('createdb', '-U', 'axiom', database);
  created = true;
  sql(`CREATE TABLE public.axiom_schema_migrations (
    migration_name text PRIMARY KEY, checksum_sha256 text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now());
    CREATE FUNCTION reject_probe_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'AXIOM_EXPECTED_LEDGER_FAILURE'; END $$;
    CREATE TRIGGER reject_probe_ledger BEFORE INSERT ON public.axiom_schema_migrations
      FOR EACH ROW EXECUTE FUNCTION reject_probe_ledger();`);
  const run = () => invoke(['exec', '--env',
    `MIGRATOR_DATABASE_URL=postgresql:///${database}?user=axiom`,
    container, 'sh', `${directory}/scripts/migrate.sh`]);
  const rejected = run();
  assert.notEqual(rejected.status, 0, 'Ledger fault must fail the runner');
  assert.ok(rejected.stderr?.includes('AXIOM_EXPECTED_LEDGER_FAILURE'),
    'Runner must reach the injected ledger fault, not fail for unrelated setup');
  assert.equal(sql("SELECT to_regclass('public.atomicity_probe') IS NULL"), 't',
    'Schema changes must roll back with the failed ledger write');
  assert.equal(sql('SELECT count(*) FROM public.axiom_schema_migrations'), '0');
  sql('DROP TRIGGER reject_probe_ledger ON public.axiom_schema_migrations');
  put('packages/db/migrations/0000_probe.sql', migration.replace('COMMIT;',
    "DO $$ BEGIN RAISE EXCEPTION 'AXIOM_EXPECTED_BODY_FAILURE'; END $$;\nCOMMIT;"));
  const bodyFailure = run();
  assert.notEqual(bodyFailure.status, 0, 'Migration-body fault must fail the runner');
  assert.ok(bodyFailure.stderr?.includes('AXIOM_EXPECTED_BODY_FAILURE'),
    'Runner must reach the injected migration-body failure');
  assert.equal(sql("SELECT to_regclass('public.atomicity_probe') IS NULL"), 't',
    'DDL before a migration-body failure must roll back');
  assert.equal(sql('SELECT count(*) FROM public.axiom_schema_migrations'), '0',
    'Failed migration body must not receive a ledger entry');
  put('packages/db/migrations/0000_probe.sql', migration);
  assert.equal(run().status, 0, 'Migration must succeed once the ledger fault is removed');
  assert.equal(sql('SELECT count(*) FROM atomicity_probe WHERE id = 1'), '1');
  assert.equal(sql('SELECT count(*) FROM public.axiom_schema_migrations'), '1');
  assert.equal(sql("SELECT checksum_sha256 FROM public.axiom_schema_migrations WHERE migration_name = '0000_probe.sql'"),
    createHash('sha256').update(migration).digest('hex'), 'Ledger must identify the exact migration bytes');
  assert.equal(run().status, 0, 'Recorded migration must be safely skipped on rerun');
  put('packages/db/migrations/0000_probe.sql', `${migration}-- checksum drift\n`);
  const drift = run();
  assert.notEqual(drift.status, 0, 'Checksum drift must fail');
  assert.ok(drift.stdout?.includes('checksum mismatch'), 'Expected checksum rejection');
  assert.equal(sql('SELECT count(*) FROM atomicity_probe'), '1');
  console.log('migration atomicity: ledger and body faults rolled back DDL; exact checksum, success, rerun and drift rejection passed');
} finally {
  if (created) exec('dropdb', '-U', 'axiom', '--force', database);
  if (directory && /^\/tmp\/axiom-migrate\.[A-Za-z0-9]+$/.test(directory)) {
    exec('rm', '-f', `${directory}/scripts/migrate.sh`, `${directory}/packages/db/migrations/0000_probe.sql`);
    exec('rmdir', `${directory}/scripts`, `${directory}/packages/db/migrations`,
      `${directory}/packages/db`, `${directory}/packages`, directory);
  }
}
