// Explicit local backup of the configured recovered database. Uses its existing
// database owner's local socket access; never resets roles or prints credentials.
import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
assert.equal(process.argv[2], '--local-backup');
loadEnvFile(new URL('../.env', import.meta.url));
const url = new URL(process.env.DATABASE_URL);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
assert.equal(url.port, '35433');
const container = 'axiom-recovery-postgres';
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true,
    timeout: 120_000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, 'Local backup command failed; diagnostics suppressed');
  return result.stdout.trim();
}
const ports = JSON.parse(docker(['inspect', '--format', '{{json .HostConfig.PortBindings}}', container]));
assert.deepEqual(ports['5432/tcp'], [{ HostIp: '127.0.0.1', HostPort: '35433' }]);
assert.equal(docker(['inspect', '--format', '{{.State.Running}}', container]), 'true');
const require = createRequire(new URL('../packages/db/package.json', import.meta.url));
const { Client } = require('pg');
const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000,
  statement_timeout: 5000, application_name: 'axiom-backup-inventory' });
let info;
try {
  await client.connect();
  ({ rows: [info] } = await client.query(`SELECT current_database() AS name,
    pg_get_userbyid(d.datdba) AS owner, (r.rolsuper OR r.rolbypassrls) AS owner_can_backup,
    pg_database_size(d.oid)::text AS bytes FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba
    WHERE d.datname=current_database()`));
} catch { throw new Error('Read-only backup inventory failed; diagnostics suppressed'); }
finally { await client.end().catch(() => {}); }
assert.equal(info.owner_can_backup, true, 'Database owner cannot produce a full RLS-inclusive backup');
assert.ok(Number(info.bytes) < 2 * 1024 * 1024 * 1024, 'Review backup capacity for databases >=2GiB');
const exec = (...args) => docker(['exec', container, ...args]);
// Verify current local access before creating any backup artifacts.
assert.equal(exec('psql', '-X', '-w', '-U', info.owner, '-d', info.name, '-t', '-A',
  '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT current_database()'), info.name);
const directory = exec('mktemp', '-d', '/tmp/axiom-recovery-backup.XXXXXXXX');
assert.match(directory, /^\/tmp\/axiom-recovery-backup\.[A-Za-z0-9]+$/);
exec('chmod', '700', directory);
exec('pg_dump', '-w', '-U', info.owner, '-d', info.name, '--lock-wait-timeout=5s',
  '-Fc', '-f', `${directory}/database.dump`);
exec('chmod', '600', `${directory}/database.dump`);
// Validate that pg_restore can read the archive, without emitting table entries.
const listing = exec('pg_restore', '--list', `${directory}/database.dump`);
assert.ok(listing.includes('TABLE DATA'), 'Archive must include application data');
const sha256 = exec('sha256sum', `${directory}/database.dump`).split(/\s+/)[0];
assert.match(sha256, /^[a-f0-9]{64}$/);
console.log(JSON.stringify({ backup_created: true, database_size_bytes: Number(info.bytes),
  container, backup_path: `${directory}/database.dump`, sha256,
  scope: 'Private local logical archive; restore not yet verified; source schema unchanged' }));
