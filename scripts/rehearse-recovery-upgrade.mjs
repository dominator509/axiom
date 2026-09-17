// Restore an existing verified local archive into a new access-restricted DB.
// Never changes the source DB, cluster roles, credentials, or migration history.
import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
assert.equal(process.argv[2], '--restore-copy');
const archive = process.argv[3];
const expected = process.argv[4];
assert.match(archive ?? '', /^\/tmp\/axiom-recovery-backup\.[A-Za-z0-9]+\/database\.dump$/);
assert.match(expected ?? '', /^[a-f0-9]{64}$/);
loadEnvFile(new URL('../.env', import.meta.url));
const url = new URL(process.env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
assert.equal(url.port, '35433');
const container = 'axiom-recovery-postgres';
function docker(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', windowsHide: true,
    timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, 'Restore-copy command failed; copy retained for inspection, diagnostics suppressed');
  return result.stdout.trim();
}
assert.equal(docker(['inspect', '--format', '{{.State.Running}}', container]), 'true');
assert.deepEqual(JSON.parse(docker(['inspect', '--format', '{{json .HostConfig.PortBindings}}', container]))['5432/tcp'],
  [{ HostIp: '127.0.0.1', HostPort: '35433' }]);
assert.equal(docker(['exec', container, 'sha256sum', archive]).split(/\s+/)[0], expected);
const require = createRequire(new URL('../packages/db/package.json', import.meta.url));
const { Client } = require('pg');
const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000, statement_timeout: 5000 });
let owner;
let timescale;
try {
  await client.connect();
  ({ rows: [{ owner }] } = await client.query('SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()'));
  ({ rows: [timescale] } = await client.query("SELECT extversion FROM pg_extension WHERE extname='timescaledb'"));
} catch { throw new Error('Read-only restore inventory failed'); }
finally { await client.end().catch(() => {}); }
const copy = `axiom_upgrade_${randomBytes(8).toString('hex')}`;
assert.match(copy, /^axiom_upgrade_[a-f0-9]{16}$/);
const exec = (...args) => docker(['exec', container, ...args]);
const sql = statement => docker(['exec', '-i', container, 'psql', '-X', '-w', '-q', '-t', '-A',
  '-U', owner, '-d', copy, '-v', 'ON_ERROR_STOP=1'], statement);
exec('createdb', '-w', '-U', owner, '-T', 'template0', copy);
console.log(JSON.stringify({ restore_copy: copy, source_unchanged: true }));
sql(`REVOKE CONNECT ON DATABASE "${copy}" FROM PUBLIC;`);
if (timescale) {
  assert.match(timescale.extversion, /^[0-9]+\.[0-9]+\.[0-9]+$/);
  sql(`CREATE EXTENSION timescaledb VERSION '${timescale.extversion}'; SELECT timescaledb_pre_restore();`);
}
exec('pg_restore', '-w', '-U', owner, '--exit-on-error', '-d', copy, archive);
if (timescale) sql('SELECT timescaledb_post_restore();');
assert.equal(sql(`SELECT has_database_privilege('axiom_app', '${copy}', 'CONNECT');`), 'f',
  'Runtime must not connect to the rehearsal copy');
const tables = JSON.parse(sql("SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public'"));
let rows = 0;
for (const table of tables) {
  assert.match(table, /^[a-z_][a-z0-9_]*$/);
  rows += Number(sql(`SELECT count(*) FROM public."${table}";`));
}
console.log(JSON.stringify({ restore_completed: true, copy, public_tables: tables.length,
  total_public_rows: rows, runtime_connect_denied: true,
  scope: 'Archive restored with exit-on-error; schema upgrade not yet run; copy retained privately' }));
