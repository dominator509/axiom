// Real PostgreSQL contract test for migration 0025 in a fresh disposable DB.
// No application database, real account or provider credential is accessed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
assert.equal(process.argv[2], '--isolated-fixture');
const container = 'axiom-ci-local-6cefdc1';
const database = `axiom_media_attempt_${randomBytes(8).toString('hex')}`;
const invoke = (args, input) => spawnSync('docker', args, {
  input, encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024,
});
const checked = (args, input) => {
  const result = invoke(args, input);
  assert.equal(result.status, 0, 'Fixture command failed (diagnostic suppressed)');
  return result.stdout.trim();
};
const labels = JSON.parse(checked(['inspect', '--format', '{{json .Config.Labels}}', container]));
assert.equal(labels['axiom.purpose'], 'isolated-ci-validation');
assert.equal(checked(['inspect', '--format', '{{.State.Running}}', container]), 'true');
const query = (statement, success = true) => {
  const result = invoke(['exec', '-i', container, 'psql', '-X', '-q', '-t', '-A',
    '-U', 'axiom', '-d', database, '-v', 'ON_ERROR_STOP=1'], statement);
  if (success) assert.equal(result.status, 0, 'Expected SQL success (diagnostic suppressed)');
  else {
    assert.notEqual(result.status, 0, 'Expected policy/privilege denial');
    assert.match(result.stderr, /permission denied|row-level security/);
  }
  return result.stdout.trim();
};
const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const job = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const context = org => `SET ROLE axiom_app; SET app.current_org_id = '${org}';`;
const insert = org => `INSERT INTO media_generation_attempt(job_id, org_id, bundle_id, model_id, user_id, kind)
 VALUES ('${job}', '${org}', '${job}', '${job}', 'fixture-operator', 'image')`;
let created = false;
try {
  checked(['exec', container, 'createdb', '-U', 'axiom', database]);
  created = true;
  // Only the migration's org FK prerequisite is required by this focused test.
  query(`CREATE TABLE org(id uuid PRIMARY KEY); INSERT INTO org VALUES ('${a}'), ('${b}');
    GRANT USAGE ON SCHEMA public TO axiom_app;`);
  query(`BEGIN; ${readFileSync(new URL('../packages/db/migrations/0025_media_generation_attempt.sql', import.meta.url), 'utf8')} COMMIT;`);
  assert.equal(query("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='media_generation_attempt'::regclass"), 't');
  query(`${context(a)} ${insert(a)};`);
  assert.equal(query(`${context(b)} SELECT count(*) FROM media_generation_attempt;`), '0');
  query(`${context(b)} ${insert(a)};`, false);
  for (const statement of [
    'DELETE FROM media_generation_attempt', 'TRUNCATE media_generation_attempt',
    `UPDATE media_generation_attempt SET user_id='other'`,
    `UPDATE media_generation_attempt SET org_id='${b}'`,
    "UPDATE media_generation_attempt SET kind='video'",
    `UPDATE media_generation_attempt SET job_id='${b}'`,
  ]) query(`${context(a)} ${statement};`, false);
  assert.equal(query(`${context(a)} ${insert(a)} ON CONFLICT DO NOTHING RETURNING job_id;`), '');
  // Simulate the outer job transaction rolling back after the independent
  // dispatch transaction committed. A subsequent delivery still sees it.
  query(`${context(a)} BEGIN; UPDATE media_generation_attempt SET state='completed',
    asset_id='${b}', completed_at=now(); ROLLBACK;`);
  assert.equal(query(`${context(a)} SELECT state FROM media_generation_attempt;`), 'dispatched');
  query(`${context(a)} UPDATE media_generation_attempt SET state='completed', asset_id='${b}', completed_at=now();`);
  assert.equal(query(`${context(a)} SELECT state FROM media_generation_attempt;`), 'completed');
  console.log('media attempt migration: real PostgreSQL forced RLS, tenant isolation, immutable dispatch fields, duplicate suppression and rollback persistence passed');
} finally {
  assert.match(database, /^axiom_media_attempt_[0-9a-f]{16}$/);
  if (created) checked(['exec', container, 'dropdb', '-U', 'axiom', database]);
}
