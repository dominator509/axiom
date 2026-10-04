// Runs only inside the owned network-disabled fixture, against real production code.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { db, pool, schema } from '@axiom/db';
import { sql, eq } from 'drizzle-orm';
import { processJob, defaultExecutors, readKillSwitch } from '@axiom/worker';
import { writeAudit, verifyAuditChain, tosApprovalFailure } from './dist/routes/helpers.js';

assert.match(process.env.AXIOM_L5_FIXTURE ?? '', /^[a-f0-9-]{36}$/);
for (const [key, user] of [['DATABASE_URL', 'axiom_app'], ['L5_OWNER_DATABASE_URL', 'axiom']]) {
  const url = new URL(process.env[key]);
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/axiom_test'); assert.equal(url.username, user);
}
const { Client } = createRequire(import.meta.resolve('@axiom/db'))('pg');
const admin = new Client({ connectionString: process.env.L5_OWNER_DATABASE_URL, statement_timeout: 10000 });
await admin.connect();
const report = { l5Runtime: true, node: process.versions.node, tests: [], passed: 0, failed: 0, skipped: 0 };
async function check(name, operation) {
  try { await operation(); report.tests.push({ name, passed: true }); report.passed++; }
  catch (error) { report.tests.push({ name, passed: false, error: error.message }); report.failed++; }
}
const scoped = (org, operation) => db.transaction(async tx => {
  await tx.execute(sql`SELECT set_config('app.current_org_id', ${org}, true)`);
  return operation(tx);
});
async function tenant() {
  const org = randomUUID(), model = randomUUID();
  await admin.query('INSERT INTO org(id,name,slug) VALUES($1,$2,$3)', [org, 'Owned L5 fixture', org]);
  await admin.query('INSERT INTO model_profile(id,org_id,display_name,handle) VALUES($1,$2,$3,$4)', [model, org, 'Synthetic talent', model]);
  return { org, model };
}
async function vision(port, path, body, authorized = true) {
  return fetch(`http://127.0.0.1:${port}${path}`, { method: body ? 'POST' : 'GET',
    headers: { ...(authorized ? { Authorization: `Bearer ${process.env.AXIOM_VISION_AUTH_TOKEN}` } : {}), 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(90000) });
}
async function jobFixture(kind = 'tos.scan', mediaKind = 'image', lostLease = false) {
  const { org, model } = await tenant();
  const bundle = randomUUID(), job = randomUUID(), asset = randomUUID();
  const key = mediaKind === 'video' ? 'source.mp4' : 'fixture.png';
  const bytes = readFileSync(`/app/var/media/${key}`), hash = createHash('sha256').update(bytes).digest();
  await scoped(org, async tx => {
    await tx.insert(schema.asset).values({ id: asset, orgId: org, modelId: model, kind: mediaKind,
      fileName: key, mimeType: mediaKind === 'video' ? 'video/mp4' : 'image/png', fileSize: bytes.length, storageKey: key, sha256: hash });
    await tx.insert(schema.contentBundle).values({ id: bundle, orgId: org, modelId: model, assetId: asset,
      state: 'generated', captions: { telegram: 'A blue geometric fixture.' }, hashtags: [], tosReport: { verdict: 'pending' } });
    await tx.insert(schema.job).values({ id: job, orgId: org, queue: 'l5-fixture', kind,
      state: 'running', payload: { bundleId: bundle, targetId: randomUUID() }, attempts: 0,
      maxAttempts: 1, lockedBy: lostLease ? 'replacement-worker' : 'l5-worker', lockedAt: new Date() });
  });
  const result = await scoped(org, tx => tx.execute(sql`SELECT * FROM job WHERE id=${job}`));
  return { org, model, bundle, job: result.rows[0], hash: hash.toString('hex') };
}
const state = fixture => scoped(fixture.org, async tx => ({
  bundle: (await tx.select().from(schema.contentBundle).where(eq(schema.contentBundle.id, fixture.bundle)))[0],
  job: (await tx.select().from(schema.job).where(eq(schema.job.id, fixture.job.id)))[0],
  cards: (await tx.execute(sql`SELECT * FROM job WHERE kind='relay.card' AND payload->>'bundleId'=${fixture.bundle}`)).rows,
}));

try {
  await check('runtime connection has enforced tenant privileges', async () => {
    assert.deepEqual((await pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows,
      [{ rolsuper: false, rolbypassrls: false }]);
  });
  for (const path of ['/vision/tos-classify', '/vision/nsfw-detect']) {
    await check(`${path}: real pinned inference and auth/path boundaries`, async () => {
      assert.equal((await vision(8101, path, { image_path: 'fixture.png' }, false)).status, 401);
      assert.equal((await vision(8101, path, { image_path: '/etc/passwd' })).status, 400);
      const response = await vision(8101, path, { image_path: 'fixture.png' });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.engine, 'onnx-vit'); assert.equal(result.overridden, false); assert.equal(result.override_source, null);
      assert.deepEqual(result.labels, ['drawings', 'hentai', 'neutral', 'porn', 'sexy']);
      assert.equal(result.probabilities.length, 5);
      assert.ok(result.probabilities.every(p => Number.isFinite(p) && p >= 0 && p <= 1));
      assert.ok(Math.abs(result.probabilities.reduce((a,b) => a+b, 0) - 1) < 1e-6);
    });
  }
  await check('missing model readiness and inference fail closed', async () => {
    assert.equal((await vision(8102, '/health', undefined, false)).status, 503);
    assert.equal((await vision(8102, '/vision/tos-classify', { image_path: 'fixture.png' })).status, 503);
  });
  for (const mediaKind of ['image', 'video']) {
    await check(`${mediaKind}: worker persists real ToS and one durable handoff`, async () => {
      const fixture = await jobFixture('tos.scan', mediaKind);
      assert.equal(await processJob(fixture.job, defaultExecutors, 'l5-worker', {}), 'done');
      const records = await state(fixture);
      assert.equal(records.job.state, 'done'); assert.equal(records.cards.length, 1);
      assert.equal(records.bundle.tosReport.verdict, mediaKind === 'video' ? 'review' : 'pass');
      if (mediaKind === 'video') {
        const scan = records.bundle.tosReport.videoScan;
        assert.equal(scan.assetSha256, fixture.hash); assert.equal(scan.policy, 'sampled-2fps-v1');
        assert.equal(scan.automatedScores[0].verdict, 'pass'); assert.ok(scan.frameCount >= 3);
        assert.notEqual(tosApprovalFailure(records.bundle.tosReport, ['telegram']), null, 'Sampled video needs explicit review');
      }
      await assert.rejects(processJob(fixture.job, defaultExecutors, 'l5-worker', {}), /lease ownership lost/);
      assert.equal((await state(fixture)).cards.length, 1, 'Replayed completed scan cannot duplicate handoff');
    });
  }
  await check('lost worker lease rolls back ToS verdict and handoff together', async () => {
    const fixture = await jobFixture('tos.scan', 'image', true);
    await assert.rejects(processJob(fixture.job, defaultExecutors, 'l5-worker', {}), /lease ownership lost/);
    const records = await state(fixture);
    assert.equal(records.bundle.tosReport.verdict, 'pending'); assert.equal(records.cards.length, 0);
    assert.equal(records.job.state, 'running'); assert.equal(records.job.lockedBy, 'replacement-worker');
  });
  for (const [name, port] of [['missing model', 8102], ['unrequested override', 8103], ['unavailable service', 8199]]) {
    await check(`${name}: worker never stores a passing verdict or approval handoff`, async () => {
      const fixture = await jobFixture();
      const original = process.env.VISION_ENGINE_URL;
      process.env.VISION_ENGINE_URL = `http://127.0.0.1:${port}`;
      try {
        assert.equal(await processJob(fixture.job, defaultExecutors, 'l5-worker', {}), 'dead');
        const records = await state(fixture);
        assert.equal(records.bundle.tosReport.verdict, 'pending'); assert.equal(records.cards.length, 0);
        assert.notEqual(tosApprovalFailure(records.bundle.tosReport, ['telegram']), null);
      } finally { process.env.VISION_ENGINE_URL = original; }
    });
  }
  for (const kind of ['publish.target', 'relay.card']) {
    await check(`${kind}: missing and disabled safety state parks real executor`, async () => {
      for (const configured of [false, true]) {
        const fixture = await jobFixture(kind);
        if (configured) await scoped(fixture.org, tx => tx.insert(schema.orgSettings).values({ orgId: fixture.org, publishingEnabled: false }));
        assert.equal(await scoped(fixture.org, tx => readKillSwitch(tx, fixture.org)), true);
        assert.equal(await processJob(fixture.job, defaultExecutors, 'l5-worker', {}), 'parked');
        const records = await state(fixture);
        assert.equal(records.job.state, 'ready'); assert.equal(records.job.lockedBy, null);
        assert.match(records.job.lastError, /kill switch/i);
      }
    });
  }
  await check('audit chain round-trips nested JSON through PostgreSQL', async () => {
    const { org } = await tenant();
    await scoped(org, tx => writeAudit(tx, org, 'l5-operator', 'l5.audit', 'fixture', { reason: 'approved', nested: { b: 2, a: [1, true, null] } }));
    const result = await scoped(org, tx => verifyAuditChain(tx, org));
    assert.equal(result.rows, 1); assert.equal(result.valid, true);
  });
  for (const detail of [{ reason: 'changed' }, { nested: { approval: false } }, { steps: ['reordered', 'actions'] }]) {
    await check(`audit detects detail tampering: ${Object.keys(detail)[0]}`, async () => {
      const { org } = await tenant();
      await scoped(org, tx => writeAudit(tx, org, 'l5-operator', 'l5.audit', 'fixture', { reason: 'approved', nested: { approval: true }, steps: ['actions', 'reordered'] }));
      assert.equal((await scoped(org, tx => verifyAuditChain(tx, org))).valid, true);
      // Only this new disposable tenant is altered by its fixture owner.
      await admin.query('UPDATE audit_log SET detail=detail || $2::jsonb WHERE org_id=$1', [org, JSON.stringify(detail)]);
      assert.equal((await scoped(org, tx => verifyAuditChain(tx, org))).valid, false);
    });
  }
  for (const verb of ['UPDATE', 'DELETE']) {
    await check(`runtime audit ${verb} privilege is denied`, async () => {
      const { org } = await tenant();
      await scoped(org, tx => writeAudit(tx, org, 'l5-operator', 'l5.audit', 'fixture', {}));
      await assert.rejects(scoped(org, tx => tx.execute(sql.raw(verb === 'UPDATE'
        ? "UPDATE audit_log SET detail='{}'::jsonb" : 'DELETE FROM audit_log'))), error => error.code === '42501' || error.cause?.code === '42501');
      assert.equal((await scoped(org, tx => verifyAuditChain(tx, org))).rows, 1);
    });
  }
  await check('concurrent API and worker audit writers form one verifiable chain', async () => {
    const { org } = await tenant();
    await Promise.all(Array.from({ length: 12 }, (_, index) => scoped(org, tx => index % 2
      ? writeAudit(tx, org, 'l5-operator', 'l5.audit', String(index), { index })
      : defaultExecutors['incident.notify']({ tx, workerId: 'l5-worker', killSwitchEnabled: true,
        job: { org_id: org, payload: { incidentId: randomUUID(), message: `Synthetic incident ${index}` } } }))));
    const result = await scoped(org, tx => verifyAuditChain(tx, org));
    assert.equal(result.rows, 12); assert.equal(result.valid, true);
  });
} finally {
  await pool.end(); await admin.end();
  report.total = report.passed + report.failed + report.skipped;
  console.log(JSON.stringify(report));
  process.exitCode = report.failed ? 1 : 0;
}
