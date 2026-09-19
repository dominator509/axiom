// Read-only readiness inventory. Existing credentials are consumed by pg only;
// connection strings, account identities and error messages are never printed.
import { createRequire } from 'node:module';
import { loadEnvFile } from 'node:process';
import { readFileSync } from 'node:fs';
const require = createRequire(new URL('../packages/db/package.json', import.meta.url));
const { Client } = require('pg');
try { loadEnvFile(new URL('../.env', import.meta.url)); } catch (error) {
  if (error.code !== 'ENOENT') throw new Error('Local configuration could not be loaded');
}
if (!process.env.DATABASE_URL) {
  console.log('DATABASE_URL: missing');
  process.exit(1);
}
const destination = new URL(process.env.DATABASE_URL);
const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(destination.hostname);
console.log(JSON.stringify({ configured_loopback: loopback, configured_port: destination.port || '5432' }));
if (process.argv[2] === '--port') {
  if (!loopback || !/^\d{1,5}$/.test(process.argv[3] ?? '') || Number(process.argv[3]) > 65535)
    throw new Error('Port probe requires a valid loopback port');
  destination.port = process.argv[3];
}
const client = new Client({ connectionString: destination.toString(),
  connectionTimeoutMillis: 5000, statement_timeout: 5000,
  application_name: 'axiom-read-only-readiness' });
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const { rows: [role] } = await client.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
  const tables = ['auth_user', 'auth_session', 'org', 'model_profile', 'asset', 'content_bundle', 'job',
    'media_generation_attempt', 'axiom_schema_migrations'];
  const { rows } = await client.query(
    'SELECT name, to_regclass(format(\'public.%I\', name)) IS NOT NULL AS present FROM unnest($1::text[]) AS name', [tables]);
  console.log(JSON.stringify({ database_connected: true, role_superuser: role.rolsuper,
    role_bypasses_rls: role.rolbypassrls, tables: rows }));
  if (process.argv.includes('--schema-shape')) {
    const { getTableConfig } = require('drizzle-orm/pg-core');
    const schema = await import('../packages/db/dist/schema/index.js');
    const { rows: columns } = await client.query(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'");
    const actual = new Map();
    for (const column of columns) {
      if (!actual.has(column.table_name)) actual.set(column.table_name, new Set());
      actual.get(column.table_name).add(column.column_name);
    }
    const missingTables = [];
    const missingColumns = [];
    const seen = new Set();
    for (const value of Object.values(schema)) {
      let table;
      try { table = getTableConfig(value); } catch { continue; }
      if (!table.name || seen.has(table.name)) continue;
      seen.add(table.name);
      if (!actual.has(table.name)) missingTables.push(table.name);
      else for (const column of table.columns) {
        if (!actual.get(table.name).has(column.name)) missingColumns.push(`${table.name}.${column.name}`);
      }
    }
    console.log(JSON.stringify({ checked_schema_tables: seen.size,
      missing_tables: missingTables.sort(), missing_columns: missingColumns.sort(),
      scope: 'Names only; types, constraints, policies, grants and migration checksums still require reconciliation' }));
  }
  if (process.argv.includes('--migration-contracts')) {
    const { rows: functions } = await client.query(`
      SELECT p.proname, p.prosecdef, p.prosrc, owner.rolbypassrls AS owner_bypasses_rls,
        EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
          WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
      JOIN pg_roles owner ON owner.oid=p.proowner
      WHERE ns.nspname='public' AND p.proname=ANY($1::text[])`,
    [['claim_job', 'resolve_relay_card', 'resolve_model_org', 'load_model_network_configs']]);
    const migration = readFileSync(new URL('../packages/db/migrations/0018_fail_closed_external_side_effect_recovery.sql', import.meta.url), 'utf8');
    const expectedClaimBody = migration.match(/AS \$\$([\s\S]*?)\$\$/)?.[1].replace(/\r\n/g, '\n').trim();
    if (!expectedClaimBody) throw new Error('Expected claim function source unavailable');
    const { rows: identities } = await client.query(`SELECT indexname FROM pg_indexes
      WHERE schemaname='public' AND indexname=ANY($1::text[])`,
    [['viral_exemplar_identity', 'relay_card_pending_dispatch_unique', 'idx_consent_record_org_model']]);
    const { rows: authentication } = await client.query(`SELECT name,
      has_table_privilege(current_user, 'public.' || name, 'SELECT') AS can_select,
      has_table_privilege(current_user, 'public.' || name, 'INSERT') AS can_insert,
      has_table_privilege(current_user, 'public.' || name, 'UPDATE') AS can_update,
      has_table_privilege(current_user, 'public.' || name, 'DELETE') AS can_delete
      FROM unnest($1::text[]) AS name`, [['auth_user', 'auth_session', 'auth_account', 'auth_verification']]);
    console.log(JSON.stringify({ migration_contracts: {
      functions: functions.map(({ prosrc, ...entry }) => ({ ...entry,
        ...(entry.proname === 'claim_job' ? { matches_0018_body: prosrc.replace(/\r\n/g, '\n').trim() === expectedClaimBody } : {}) })),
      present_identity_indexes: identities.map(row => row.indexname).sort(), authentication,
      migrator_configuration_present: Boolean(process.env.MIGRATOR_DATABASE_URL),
    } }));
  }
  await client.query('ROLLBACK');
} catch (error) {
  console.log(JSON.stringify({ database_connected: false,
    code: typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'READINESS_FAILED' }));
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
