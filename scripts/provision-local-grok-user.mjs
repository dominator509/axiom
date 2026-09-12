// Explicit local operator action only; never invoked by the public signup API.
import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
const [mode, email, expectedId] = process.argv.slice(2);
assert.ok(['--inspect', '--rehearse', '--assign'].includes(mode));
assert.ok(email && email.length <= 254 && !/[\r\n]/.test(email));
if (mode !== '--inspect') assert.ok(expectedId && expectedId.length <= 128);
loadEnvFile(new URL('../.env', import.meta.url));
const url = new URL(process.env.DATABASE_URL);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
assert.equal(url.port, '35433', 'Only the configured local recovery database is allowed');
const require = createRequire(new URL('../packages/db/package.json', import.meta.url));
const { Client } = require('pg');
const client = new Client({ connectionString: url.href, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
try {
  await client.connect();
  await client.query(mode === '--inspect' ? 'BEGIN READ ONLY' : 'BEGIN');
  const result = await client.query(`SELECT id, org_id, role FROM auth_user WHERE email=$1${mode === '--inspect' ? '' : ' FOR UPDATE'}`, [email]);
  assert.equal(result.rowCount, 1, 'Expected exactly one matching identity');
  const user = result.rows[0];
  if (mode === '--inspect') {
    console.log(JSON.stringify({ id: user.id, assigned: Boolean(user.org_id), role: user.role }));
    await client.query('ROLLBACK');
  } else {
    assert.equal(user.id, expectedId, 'Identity changed since inspection');
    assert.equal(user.org_id, null, 'Refusing to reassign an existing workspace member');
    assert.equal(user.role, 'operator', 'Refusing to change an unexpected role');
    const orgId = randomUUID();
    await client.query("SELECT set_config('app.current_org_id',$1,true)", [orgId]);
    await client.query('INSERT INTO org (id,name,slug,features) VALUES ($1,$2,$3,$4::jsonb)',
      [orgId, 'Grok connection workspace', `grok-connect-${orgId}`, '[]']);
    const changed = await client.query('UPDATE auth_user SET org_id=$1,updated_at=now() WHERE id=$2 AND org_id IS NULL AND role=$3 RETURNING id', [orgId, user.id, 'operator']);
    assert.equal(changed.rowCount, 1);
    // Same sorted-key payload contract as API writeAudit; this new org has no prior chain.
    const ts = new Date().toISOString();
    const prevHash = Buffer.alloc(32);
    const payload = { org_id: orgId, actor_ref: 'local-operator', action: 'workspace.grok-onboard',
      target: user.id, detail: {}, ts, prev_hash: prevHash.toString('hex') };
    const rowHash = createHash('sha256').update(JSON.stringify(payload, Object.keys(payload).sort())).digest();
    await client.query('INSERT INTO audit_log (org_id,actor_ref,action,target,detail,ts,prev_hash,row_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [orgId, payload.actor_ref, payload.action, user.id, {}, ts, prevHash, rowHash]);
    const { rows: [counts] } = await client.query('SELECT (SELECT count(*) FROM model_profile) AS models,(SELECT count(*) FROM job) AS jobs,(SELECT count(*) FROM audit_log) AS audits');
    assert.equal(counts.models, '0'); assert.equal(counts.jobs, '0'); assert.equal(counts.audits, '1');
    await client.query(mode === '--assign' ? 'COMMIT' : 'ROLLBACK');
    console.log(JSON.stringify({ outcome: mode === '--assign' ? 'assigned' : 'rehearsed-and-rolled-back',
      role: 'operator', models: 0, jobs: 0, auditEntries: 1 }));
  }
} catch {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Local provisioning failed; no credential or SQL diagnostics emitted');
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
