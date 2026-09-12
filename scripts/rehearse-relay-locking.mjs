import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Isolated PostgreSQL lock semantics, not a live provider dispatch test.
assert.equal(process.argv[2], '--isolated-fixture', 'Pass --isolated-fixture explicitly');
const container = 'axiom-ci-local-6cefdc1';
const inspected = spawnSync('docker', ['inspect', container], {
  encoding: 'utf8', windowsHide: true, timeout: 10_000,
});
assert.equal(inspected.status, 0, 'Disposable container inspection failed');
const metadata = JSON.parse(inspected.stdout)[0];
assert.equal(metadata.Config.Labels?.['axiom.purpose'], 'isolated-ci-validation');
assert.equal(metadata.State.Running, true);
assert.ok(metadata.NetworkSettings.Ports['5432/tcp'].some(
  (port) => port.HostIp === '127.0.0.1' && port.HostPort === '55432',
));
const { Client } = createRequire(new URL('../packages/worker/package.json', import.meta.url))('pg');
const database = `axiom_relay_lock_${randomBytes(8).toString('hex')}`;
const config = { host: '127.0.0.1', port: 55432, user: 'axiom', password: 'changeme',
  connectionTimeoutMillis: 5000, statement_timeout: 5000 };
const admin = new Client({ ...config, database: 'postgres' });
const clients = [];
let created = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  created = true;
  for (let index = 0; index < 3; index++) {
    const client = new Client({ ...config, database });
    await client.connect();
    clients.push(client);
  }
  const [reader, writer, marker] = clients;
  await reader.query("CREATE TABLE bundle (id integer PRIMARY KEY, state text); INSERT INTO bundle VALUES (1, 'generated'); CREATE TABLE card (bundle_id integer REFERENCES bundle(id));");
  // Without a row lock, a revision can commit after the worker's read.
  await reader.query('BEGIN');
  await reader.query('SELECT * FROM bundle WHERE id = 1');
  await writer.query("UPDATE bundle SET state = 'revising' WHERE id = 1");
  await reader.query('ROLLBACK');
  await writer.query("UPDATE bundle SET state = 'generated' WHERE id = 1");

  // FOR UPDATE would block the independent dispatch marker's FK check.
  await reader.query('BEGIN');
  await reader.query('SELECT * FROM bundle WHERE id = 1 FOR UPDATE');
  await marker.query("SET lock_timeout = '500ms'");
  await assert.rejects(marker.query('INSERT INTO card VALUES (1)'), { code: '55P03' });
  await reader.query('ROLLBACK');

  // NO KEY UPDATE must block a decision, yet permit the independent marker
  // even when that stronger decision lock is already waiting in the queue.
  await reader.query('BEGIN');
  await reader.query('SELECT * FROM bundle WHERE id = 1 FOR NO KEY UPDATE');
  await writer.query('BEGIN');
  const writerPid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const pending = writer.query('SELECT * FROM bundle WHERE id = 1 FOR UPDATE')
    .then(() => ({ ok: true }), (error) => ({ ok: false, code: error.code }));
  let blocked = false;
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const result = await marker.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1', [writerPid]);
    if (result.rows[0]?.wait_event_type === 'Lock') { blocked = true; break; }
    await delay(20);
  }
  assert.ok(blocked, 'Concurrent decision must wait on the bundle lock');
  await marker.query('INSERT INTO card VALUES (1)');
  assert.equal((await marker.query('SELECT count(*)::integer AS count FROM card')).rows[0].count, 1);
  await reader.query('COMMIT');
  assert.deepEqual(await pending, { ok: true }, 'Decision must resume after dispatch transaction ends');
  await writer.query("UPDATE bundle SET state = 'revising' WHERE id = 1");
  await writer.query('COMMIT');
  assert.equal((await reader.query('SELECT state FROM bundle WHERE id = 1')).rows[0].state, 'revising');
  console.log('relay locking: unlocked revision reproduced; FOR UPDATE blocked FK marker; NO KEY UPDATE held decision while marker committed and released decision afterward');
} finally {
  for (const client of clients) await client.end();
  if (created) await admin.query(`DROP DATABASE ${database}`);
  await admin.end();
}
