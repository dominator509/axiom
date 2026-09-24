// Upgrade only the explicitly named, access-restricted rehearsal copy. This
// deliberately does not establish a checksum baseline for the recovered DB.
import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
assert.equal(process.argv[2], '--rehearsal-copy');
const copy = process.argv[3];
assert.match(copy ?? '', /^axiom_upgrade_[a-f0-9]{16}$/);
loadEnvFile(new URL('../.env', import.meta.url));
const url = new URL(process.env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
assert.equal(url.port, '35433');
assert.notEqual(decodeURIComponent(url.pathname.slice(1)), copy);
const require = createRequire(new URL('../packages/db/package.json', import.meta.url));
const { Client } = require('pg');
const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000, statement_timeout: 5000 });
let owner;
try {
  await client.connect();
  ({ rows: [{ owner }] } = await client.query('SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()'));
} catch { throw new Error('Copy-upgrade inventory failed'); }
finally { await client.end().catch(() => {}); }
const sql = (input, label) => {
  const result = spawnSync('docker', ['exec', '-i', 'axiom-recovery-postgres', 'psql', '-X', '-w',
    '-q', '-t', '-A', '-1', '-U', owner, '-d', copy, '-v', 'ON_ERROR_STOP=1'], {
    input, encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, `Copy upgrade failed at ${label}; source untouched, diagnostics suppressed`);
  return result.stdout.trim();
};
assert.equal(sql(`SELECT has_database_privilege('axiom_app', current_database(), 'CONNECT');`, 'access guard'), 'f');
assert.equal(sql('SELECT current_database();', 'target guard'), copy);
assert.equal(sql("SELECT to_regclass('public.media_generation_attempt') IS NULL;", 'unapplied guard'), 't');
const tables = JSON.parse(sql("SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public'", 'table inventory'));
const counts = () => tables.map(table => {
  assert.match(table, /^[a-z_][a-z0-9_]*$/);
  return sql(`SELECT count(*) FROM public."${table}";`, 'row count');
});
const before = counts();
const migrations = new URL('../packages/db/migrations/', import.meta.url);
const files = readdirSync(migrations).filter(name => /^00(1[4-9]|2[0-5])_.+\.sql$/.test(name)).sort();
assert.equal(files.length, 12);
for (const file of files) {
  const body = readFileSync(new URL(file, migrations), 'utf8')
    .replace(/\r\n/g, '\n').replace(/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;\s*$/gm, '');
  sql(body, file);
  console.log(`copy migration applied: ${file}`);
}
assert.deepEqual(counts(), before, 'Upgrade must preserve existing table row counts');
assert.equal(sql('SELECT count(*) FROM consent_record WHERE org_id IS NULL;', 'consent backfill'), '0');
assert.equal(sql("SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN ('viral_exemplar_identity','relay_card_pending_dispatch_unique','idx_consent_record_org_model');", 'identity indexes'), '3');
assert.equal(sql("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='media_generation_attempt'::regclass;", 'dispatch RLS'), 't');
assert.equal(sql(`SELECT has_database_privilege('axiom_app', current_database(), 'CONNECT');`, 'final access guard'), 'f');
console.log(JSON.stringify({ copy_upgrade_passed: true, copy, applied_migrations: files.length,
  preserved_table_counts: tables.length, source_unchanged: true,
  scope: 'Copy-only SQL rehearsal; no inferred baseline, source upgrade, provider or end-to-end claim' }));
