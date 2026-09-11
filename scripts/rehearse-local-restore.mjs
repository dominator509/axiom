import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';

// Opt-in logical restore of the agent-owned synthetic fixture only. This is
// not production PITR, a roles backup, or permission to touch axiom-postgres.
assert.equal(process.argv[2], '--isolated-fixture', 'Pass --isolated-fixture explicitly');
const container = 'axiom-ci-local-6cefdc1';
const source = 'axiom_test';
const destination = `axiom_restore_${randomBytes(8).toString('hex')}`;
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  // Do not emit database rows, dump content, or subprocess environments.
  assert.equal(result.status, 0, `Recovery command failed: ${args[0]} ${args[0] === 'exec' ? args[2] : ''}`);
  return result.stdout.trim();
}
const exec = (...args) => docker(['exec', container, ...args]);
const sql = (database, statement) => exec('psql', '-X', '-q', '-U', 'axiom', '-d', database, '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', statement);
const metadata = JSON.parse(docker(['inspect', container]))[0];
assert.equal(metadata.Config.Labels['axiom.purpose'], 'isolated-ci-validation');
assert.equal(metadata.State.Running, true);
assert.equal(sql(source, 'SELECT count(*) FROM platform_connection'), '0');
assert.equal(sql(source, "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'"), '0');
const tables = JSON.parse(sql(source, "SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public'"));
const fingerprints = database => Object.fromEntries(tables.map(table => {
  assert.match(table, /^[a-z_][a-z0-9_]*$/);
  const value = sql(database, `SELECT count(*) || ':' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'), 'hex') FROM public."${table}" t`);
  return [table, value];
}));
const policyQuery = "SELECT COALESCE(jsonb_agg(jsonb_build_array(c.relname,c.relrowsecurity,c.relforcerowsecurity,p.polname,p.polcmd,p.polpermissive,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY c.relname,p.polname), '[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_policy p ON p.polrelid=c.oid WHERE n.nspname='public' AND c.relkind IN ('r','p')";
const before = fingerprints(source);
const policies = sql(source, policyQuery);
assert.equal(sql(source, "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = 'axiom_app'"), 'f', 'Application role must not bypass RLS');
const tenants = JSON.parse(sql(source, "SELECT json_agg(t) FROM (SELECT org_id::text AS id, count(*)::text AS count FROM model_profile GROUP BY org_id ORDER BY org_id LIMIT 2) t"));
assert.equal(tenants?.length, 2, 'Rehearsal needs two populated synthetic tenants');
for (const tenant of tenants) assert.match(tenant.id, /^[0-9a-f-]{36}$/);
const appCount = (database, orgId, predicate = 'true') => sql(database,
  `BEGIN; SET LOCAL ROLE axiom_app; SET LOCAL app.current_org_id = '${orgId}'; SELECT current_user || ':' || count(*) FROM model_profile WHERE ${predicate}; ROLLBACK;`);
const checkIsolation = database => {
  for (const [index, tenant] of tenants.entries()) {
    assert.equal(appCount(database, tenant.id), `axiom_app:${tenant.count}`, 'Own-tenant models must remain readable');
    assert.equal(appCount(database, tenant.id, `org_id = '${tenants[1 - index].id}'`), 'axiom_app:0', 'Foreign-tenant models must be invisible');
  }
  assert.equal(appCount(database, randomUUID()), 'axiom_app:0', 'Unknown tenant must see no models');
};
checkIsolation(source);
const started = Date.now();
let created = false;
let directory;
try {
  directory = exec('mktemp', '-d', '/tmp/axiom-restore.XXXXXXXX');
  assert.match(directory, /^\/tmp\/axiom-restore\.[A-Za-z0-9]+$/);
  exec('pg_dump', '-U', 'axiom', '-d', source, '-Fc', '-f', `${directory}/backup.dump`);
  exec('createdb', '-U', 'axiom', destination);
  created = true;
  sql(destination, 'CREATE EXTENSION IF NOT EXISTS timescaledb');
  sql(destination, 'SELECT timescaledb_pre_restore()');
  exec('pg_restore', '-U', 'axiom', '--exit-on-error', '-d', destination, `${directory}/backup.dump`);
  sql(destination, 'SELECT timescaledb_post_restore()');
  assert.deepEqual(fingerprints(source), before, 'Source changed during rehearsal');
  assert.deepEqual(fingerprints(destination), before, 'Restored table data differs');
  assert.equal(sql(destination, policyQuery), policies, 'Restored RLS metadata differs');
  checkIsolation(destination);
  console.log('restored application role: own-tenant reads preserved; foreign and unknown tenant reads return zero');
  console.log(`logical restore: ${tables.length} public table fingerprints and RLS metadata preserved in ${((Date.now() - started) / 1000).toFixed(1)}s; no provider or production recovery claim`);
} finally {
  // Only artifacts created by this invocation are eligible for cleanup.
  if (created) exec('dropdb', '-U', 'axiom', '--force', destination);
  if (directory && /^\/tmp\/axiom-restore\.[A-Za-z0-9]+$/.test(directory)) {
    exec('rm', '-f', `${directory}/backup.dump`);
    exec('rmdir', directory);
  }
}
