// Explicitly authorized migration 0026 only; never runs other pending DDL.
// Rehearse on the restored backup before applying to the configured recovery DB.
import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const [mode, copy, archive, archiveHash] = process.argv.slice(2);
assert.equal(process.argv.slice(2).length, 4);
assert.ok(['--rehearse-copy', '--apply-approved'].includes(mode));
assert.match(copy ?? '', /^axiom_upgrade_[a-f0-9]{16}$/);
assert.match(archive ?? '', /^\/tmp\/axiom-recovery-backup\.[A-Za-z0-9]+\/database\.dump$/);
assert.match(archiveHash ?? '', /^[a-f0-9]{64}$/);
loadEnvFile(new URL('../.env', import.meta.url));
const url = new URL(process.env.DATABASE_URL);
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
assert.equal(url.port, '35433');
assert.ok(!url.search && !url.hash);
const container = 'axiom-recovery-postgres';
function docker(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', windowsHide: true,
    timeout: 60_000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, 'Character-lock operation failed or outcome is unconfirmed; inspect read-only before retrying. Diagnostics suppressed.');
  return result.stdout.trim();
}
assert.equal(docker(['inspect', '--format', '{{.State.Running}}', container]), 'true');
assert.deepEqual(JSON.parse(docker(['inspect', '--format', '{{json .HostConfig.PortBindings}}', container]))['5432/tcp'],
  [{ HostIp: '127.0.0.1', HostPort: '35433' }]);
assert.equal(docker(['exec', container, 'sha256sum', archive]).split(/\s+/)[0], archiveHash);
const require = createRequire(new URL('../packages/db/package.json', import.meta.url));
const { Client } = require('pg');
const client = new Client({ connectionString: url.href, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
let info;
try {
  await client.connect();
  ({ rows: [info] } = await client.query(`SELECT current_database() AS name,
    pg_get_userbyid(d.datdba) AS owner FROM pg_database d WHERE datname=current_database()`));
} catch { throw new Error('Recovery metadata inspection failed; diagnostics suppressed'); }
finally { await client.end().catch(() => {}); }
assert.notEqual(copy, info.name);
const sql = (database, input) => docker(['exec', '-i', container, 'psql', '-X', '-w', '-q', '-t', '-A',
  '-U', info.owner, '-d', database, '-v', 'ON_ERROR_STOP=1'], input);
assert.equal(sql(copy, "SELECT has_database_privilege('axiom_app',current_database(),'CONNECT');"), 'f');
const name = '0026_model_character_lock.sql';
const migration = readFileSync(new URL(`../packages/db/migrations/${name}`, import.meta.url));
const checksum = createHash('sha256').update(migration).digest('hex');
const ledgerQuery = `SELECT checksum_sha256 FROM public.axiom_schema_migrations WHERE migration_name='${name}';`;
if (mode === '--apply-approved') assert.equal(sql(copy, ledgerQuery), checksum, 'Copy must have passed migration rehearsal');
const target = mode === '--rehearse-copy' ? copy : info.name;
assert.equal(sql(target, ledgerQuery), '', 'Migration already recorded: verify rather than reapply');
assert.equal(sql(target, `SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
  AND table_name='model_profile' AND column_name IN ('character_lock_prompt','character_lock_version');`), '0');
sql(target, `BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(1935763821);
LOCK TABLE public.model_profile IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE character_lock_before ON COMMIT DROP AS
 SELECT md5(COALESCE(jsonb_agg(to_jsonb(p) ORDER BY to_jsonb(p)::text)::text,'[]')) AS digest
 FROM public.model_profile p;
${migration.toString('utf8')}
DO $verify$
DECLARE actual text;
BEGIN
 SELECT md5(COALESCE(jsonb_agg(value ORDER BY value::text)::text,'[]')) INTO actual
 FROM (SELECT to_jsonb(p)-'character_lock_prompt'-'character_lock_version' AS value FROM public.model_profile p) q;
 IF actual IS DISTINCT FROM (SELECT digest FROM character_lock_before)
 THEN RAISE EXCEPTION 'Existing profile data changed'; END IF;
 IF EXISTS (SELECT 1 FROM public.model_profile WHERE character_lock_prompt IS DISTINCT FROM '' OR character_lock_version IS DISTINCT FROM 0)
 THEN RAISE EXCEPTION 'Character-lock defaults invalid'; END IF;
END $verify$;
INSERT INTO public.axiom_schema_migrations(migration_name,checksum_sha256) VALUES('${name}','${checksum}');
COMMIT;`);
assert.equal(sql(target, ledgerQuery), checksum);
assert.equal(sql(target, `SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
 AND table_name='model_profile' AND is_nullable='NO' AND
 ((column_name='character_lock_prompt' AND data_type='text') OR (column_name='character_lock_version' AND data_type='integer'));`), '2');
assert.equal(sql(target, `SELECT count(*) FROM pg_constraint WHERE conrelid='public.model_profile'::regclass
 AND convalidated AND conname IN ('model_character_lock_length','model_character_lock_version_nonnegative');`), '2');
console.log(JSON.stringify({ mode, migration: name, committed: true, checksumVerified: true,
  existingProfileValuesPreserved: true, requiredColumnsAndConstraintsVerified: true,
  sourceUnchanged: mode === '--rehearse-copy', backupRetained: true }));
