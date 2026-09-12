// Read-only readiness check for the existing local recovery-backed API.
// Never emits configuration values, tenant rows or raw database diagnostics.
import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { createRequire } from 'node:module';

let client;
try {
  assert.deepEqual(process.argv.slice(2), ['--read-only']);
  loadEnvFile(new URL('../.env', import.meta.url));
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '35433');
  assert.ok(!url.search && !url.hash);
  const require = createRequire(new URL('../packages/db/package.json', import.meta.url));
  const { Client } = require('pg');
  client = new Client({ connectionString: url.href, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const expected = { character_lock_prompt: 'text', character_lock_version: 'integer' };
  const { rows } = await client.query(`SELECT column_name, data_type, is_nullable
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'model_profile'
    AND column_name = ANY($1::text[])`, [Object.keys(expected)]);
  const missingOrIncompatible = Object.entries(expected).filter(([name, type]) =>
    !rows.some(row => row.column_name === name && row.data_type === type && row.is_nullable === 'NO'),
  ).map(([name]) => name);
  await client.query('ROLLBACK');
  console.log(JSON.stringify({ readOnly: true, characterLockSchemaReady: missingOrIncompatible.length === 0,
    missingOrIncompatible, migrationExecuted: false }));
  if (missingOrIncompatible.length) process.exitCode = 1;
} catch {
  console.error('Local schema inspection failed; no configuration or database diagnostics emitted');
  process.exitCode = 1;
} finally {
  if (client) {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
}
