// Runs only inside the owned network-disabled fixture, against real production code.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { db, pool, schema } from '@axiom/db';
import { createConnector } from '@axiom/connectors';
import { sql, eq, and } from 'drizzle-orm';
import { processJob, defaultExecutors, publishTarget, readKillSwitch } from '@axiom/worker';
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
function safeFixtureError(error) {
  const message = String(error ?? '');
  const webhookToken = process.env.AXIOM_L5_DISCORD_WEBHOOK_TOKEN;
  return webhookToken ? message.replaceAll(webhookToken, '[FIXTURE-REDACTED]') : message;
}
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
async function relayDispatchFixture() {
  const { org, model } = await tenant();
  const bundle = randomUUID(), job = randomUUID();
  await scoped(org, async tx => {
    await tx.insert(schema.orgSettings).values({ orgId: org, publishingEnabled: true });
    await tx.insert(schema.contentBundle).values({ id: bundle, orgId: org, modelId: model,
      state: 'generated', captions: { instagram: 'Synthetic approval fixture.' }, hashtags: [],
      tosReport: { verdict: 'pass', scores: [{ platform: 'instagram', score: 0, verdict: 'pass' }] } });
    await tx.insert(schema.relayBinding).values({ orgId: org, modelId: model,
      channel: 'signal', chatRef: 'l5-fixture-signal-chat', enabled: true });
    await tx.insert(schema.job).values({ id: job, orgId: org, queue: 'l5-fixture', kind: 'relay.card',
      state: 'running', payload: { bundleId: bundle }, attempts: 0, maxAttempts: 1,
      lockedBy: 'l5-worker', lockedAt: new Date() });
  });
  const result = await scoped(org, tx => tx.execute(sql`SELECT * FROM job WHERE id=${job}`));
  return { org, model, bundle, job: result.rows[0] };
}
async function blockedPublishFixture(tosReport) {
  const { org, model } = await tenant();
  const bundle = randomUUID(), target = randomUUID(), job = randomUUID();
  await scoped(org, async tx => {
    await tx.insert(schema.orgSettings).values({ orgId: org, publishingEnabled: true });
    await tx.insert(schema.contentBundle).values({ id: bundle, orgId: org, modelId: model,
      state: 'approved', captions: { instagram: 'Synthetic blocked publish fixture.' }, hashtags: [], tosReport });
    await tx.insert(schema.postTarget).values({ id: target, orgId: org, bundleId: bundle,
      platform: 'instagram', state: 'pending', idemKey: randomBytes(32) });
    await tx.insert(schema.job).values([
      { id: randomUUID(), orgId: org, queue: 'media', kind: 'tos.scan', state: 'done',
        payload: { bundleId: bundle }, attempts: 0, maxAttempts: 1 },
      { id: job, orgId: org, queue: 'publish', kind: 'publish.target', state: 'running',
        payload: { targetId: target }, attempts: 0, maxAttempts: 1,
        lockedBy: 'l5-worker', lockedAt: new Date() },
    ]);
  });
  const result = await scoped(org, tx => tx.execute(sql`SELECT * FROM job WHERE id=${job}`));
  return { org, target, job: result.rows[0] };
}
async function successfulPublishFixture() {
  const { org, model } = await tenant();
  const asset = randomUUID(), bundle = randomUUID(), target = randomUUID(), job = randomUUID(), connection = randomUUID();
  const idemKey = randomBytes(32);
  const today = new Date().toISOString().slice(0, 10);
  const media = readFileSync('/app/var/media/fixture.png');
  const storageKey = 'fixture.png';
  await scoped(org, async tx => {
    await tx.insert(schema.orgSettings).values({ orgId: org, publishingEnabled: true });
    await tx.insert(schema.asset).values({ id: asset, orgId: org, modelId: model, kind: 'image',
      fileName: 'fixture.png', mimeType: 'image/png', fileSize: media.length, storageKey,
      sha256: createHash('sha256').update(media).digest() });
    await tx.insert(schema.contentBundle).values({ id: bundle, orgId: org, modelId: model,
      assetId: asset, state: 'approved', captions: { discord: 'Synthetic L5 publish acceptance.' }, hashtags: [],
      tosReport: { verdict: 'pass', scores: [{ platform: 'discord', score: 0, verdict: 'pass' }] } });
    await tx.insert(schema.platformConnection).values({ id: connection, orgId: org, modelId: model,
      platform: 'discord', displayName: 'L5 isolated provider fixture', encToken: randomBytes(32),
      encNonce: randomBytes(12), dekId: `l5-${randomUUID()}`, capabilities: ['publish'], status: 'connected' });
    await tx.insert(schema.consentRecord).values(['2257', 'model_release', 'id_verify', 'platform_consent'].map(docKind => ({
      id: randomUUID(), orgId: org, modelId: model, platform: 'discord', consentType: `l5-${docKind}`,
      docKind, granted: true, grantedAt: new Date(Date.now() - 60_000), expiresAt: null, revokedAt: null,
      subjectRef: 'synthetic-l5-fixture', blobRef: `l5-fixture/${docKind}`,
      sha256: randomBytes(32), documentCiphertext: null, documentMimeType: null, documentSize: null,
      validFrom: today, validTo: null,
    })));
    await tx.insert(schema.postTarget).values({ id: target, orgId: org, bundleId: bundle,
      platform: 'discord', connectionId: connection, state: 'pending', idemKey });
    await tx.insert(schema.job).values([
      { id: randomUUID(), orgId: org, queue: 'media', kind: 'tos.scan', state: 'done',
        payload: { bundleId: bundle }, attempts: 0, maxAttempts: 1 },
      { id: job, orgId: org, queue: 'publish', kind: 'publish.target', state: 'running',
        payload: { targetId: target }, attempts: 0, maxAttempts: 1,
        lockedBy: 'l5-worker', lockedAt: new Date() },
    ]);
  });
  const result = await scoped(org, tx => tx.execute(sql`SELECT * FROM job WHERE id=${job}`));
  return { org, model, bundle, target, job: result.rows[0], connection, idemKey,
    mediaUrl: 'https://media.example.invalid/assets/fixture.png' };
}
async function localDiscordProvider(fixture) {
  const deliveries = [];
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/publish');
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      deliveries.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: `fixture-message-${deliveries.length}`, type: 0, channel_id: '123456789012345678' }));
    } catch {
      response.writeHead(500);
      response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const webhookToken = process.env.AXIOM_L5_DISCORD_WEBHOOK_TOKEN ?? '';
  assert.match(webhookToken, /^[a-f0-9]{64}$/, 'A fixture-only webhook token is required');
  const auth = { accessToken: '', extra: {
    webhookUrl: `https://discord.com/api/webhooks/123456789012345678/${webhookToken}`,
    discordChannelId: '123456789012345678',
  } };
  const transport = async (providerUrl, init) => {
    const url = new URL(String(providerUrl));
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, 'discord.com');
    assert.match(url.pathname, /^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+$/);
    assert.equal(url.searchParams.get('wait'), 'true');
    return fetch(`http://127.0.0.1:${address.port}/publish`, { ...init, redirect: 'error' });
  };
  const resolver = async (_tx, orgId, modelId, target) => {
    assert.equal(orgId, fixture.org);
    assert.equal(modelId, fixture.model);
    assert.equal(target.platform, 'discord');
    assert.equal(target.connectionId, fixture.connection);
    return { connection: { id: fixture.connection }, connector: createConnector('discord', auth, transport) };
  };
  return {
    deliveries,
    resolver,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
async function publishRecords(fixture) {
  return scoped(fixture.org, async tx => ({
    target: (await tx.select().from(schema.postTarget).where(eq(schema.postTarget.id, fixture.target)))[0],
    job: (await tx.select().from(schema.job).where(eq(schema.job.id, fixture.job.id)))[0],
    ledger: (await tx.select().from(schema.idempotencyLedger).where(eq(
      schema.idempotencyLedger.idemKey, fixture.idemKey.toString('hex'))))[0] ?? null,
    markers: (await tx.select().from(schema.prePostRun).where(and(
      eq(schema.prePostRun.targetId, fixture.target), eq(schema.prePostRun.script, 'publish.dispatch')))),
  }));
}
const state = fixture => scoped(fixture.org, async tx => ({
  bundle: (await tx.select().from(schema.contentBundle).where(eq(schema.contentBundle.id, fixture.bundle)))[0],
  job: (await tx.select().from(schema.job).where(eq(schema.job.id, fixture.job.id)))[0],
  cards: (await tx.execute(sql`SELECT * FROM job WHERE kind='relay.card' AND payload->>'bundleId'=${fixture.bundle}`)).rows,
  relayMarkers: (await tx.execute(sql`SELECT id,state,channel,external_ref FROM relay_card WHERE org_id=${fixture.org} AND bundle_id=${fixture.bundle}`)).rows,
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
  for (const [name, tosReport] of [
    ['block verdict', { verdict: 'block', scores: [{ platform: 'instagram', verdict: 'block' }] }],
    ['review verdict', { verdict: 'review', scores: [{ platform: 'instagram', verdict: 'review' }] }],
    ['missing platform score', { verdict: 'pass', scores: [] }],
  ]) {
    await check(`publish.target: ${name} refuses provider dispatch`, async () => {
      const fixture = await blockedPublishFixture(tosReport);
      assert.equal(await processJob(fixture.job, defaultExecutors, 'l5-worker', {}), 'dead');
      const records = await scoped(fixture.org, async tx => ({
        job: (await tx.select().from(schema.job).where(eq(schema.job.id, fixture.job.id)))[0],
        target: (await tx.select().from(schema.postTarget).where(eq(schema.postTarget.id, fixture.target)))[0],
        dispatchMarkers: await tx.select().from(schema.prePostRun).where(and(
          eq(schema.prePostRun.targetId, fixture.target), eq(schema.prePostRun.script, 'publish.dispatch')),
        ),
      }));
      assert.equal(records.job.state, 'dead');
      assert.match(records.job.lastError, /ToS check unavailable or not passing/);
      assert.equal(records.target.state, 'pending');
      assert.equal(records.dispatchMarkers.length, 0, 'A blocked report cannot create a provider-dispatch marker');
    });
  }
  await check('publish.target: concurrent duplicate approval and ledger replay persist one remote outcome', async () => {
    const fixture = await successfulPublishFixture();
    const provider = await localDiscordProvider(fixture);
    try {
      const executors = { ...defaultExecutors, 'publish.target': ctx => publishTarget(ctx, provider.resolver) };
      const duplicateApprovalId = randomUUID();
      await scoped(fixture.org, tx => tx.insert(schema.job).values({ id: duplicateApprovalId,
        orgId: fixture.org, queue: 'publish', kind: 'publish.target', state: 'running',
        payload: { targetId: fixture.target }, attempts: 0, maxAttempts: 1,
        lockedBy: 'l5-worker-duplicate', lockedAt: new Date() }));
      const duplicateApproval = await scoped(fixture.org, tx =>
        tx.execute(sql`SELECT * FROM job WHERE id=${duplicateApprovalId}`));
      const outcomes = await Promise.all([
        processJob(fixture.job, executors, 'l5-worker', {}),
        processJob(duplicateApproval.rows[0], executors, 'l5-worker-duplicate', {}),
      ]);
      const jobErrors = await Promise.all([fixture.job.id, duplicateApprovalId].map(jobId =>
        scoped(fixture.org, async tx => {
          const row = (await tx.select({ lastError: schema.job.lastError }).from(schema.job)
            .where(eq(schema.job.id, jobId)))[0];
          return safeFixtureError(row?.lastError);
        }),
      ));
      assert.deepEqual(outcomes, ['done', 'done'], `Publish executor errors: ${JSON.stringify(jobErrors)}`);
      let records = await publishRecords(fixture);
      assert.equal(provider.deliveries.length, 1, 'Concurrent duplicate approvals must yield one provider request');
      assert.equal(provider.deliveries[0]?.embeds?.[0]?.image?.url, fixture.mediaUrl,
        'The real connector payload must include the model-scoped provider media URL');
      assert.equal(records.target.state, 'published');
      assert.equal(records.target.remoteId, 'fixture-message-1');
      assert.equal(records.ledger?.responseHash, 'fixture-message-1');
      assert.deepEqual(records.markers.map(({ status }) => status), ['success']);

      // Simulate a stale restored target row while retaining the committed
      // idempotency ledger. A later replay must restore its durable result locally.
      await scoped(fixture.org, tx => tx.update(schema.postTarget)
        .set({ state: 'pending', remoteId: null, publishedAt: null })
        .where(eq(schema.postTarget.id, fixture.target)));
      const replayJobId = randomUUID();
      await scoped(fixture.org, tx => tx.insert(schema.job).values({ id: replayJobId, orgId: fixture.org,
        queue: 'publish', kind: 'publish.target', state: 'running', payload: { targetId: fixture.target },
        attempts: 0, maxAttempts: 1, lockedBy: 'l5-worker', lockedAt: new Date() }));
      const replay = await scoped(fixture.org, tx => tx.execute(sql`SELECT * FROM job WHERE id=${replayJobId}`));
      assert.equal(await processJob(replay.rows[0], executors, 'l5-worker', {}), 'done');
      records = await publishRecords(fixture);
      assert.equal(provider.deliveries.length, 1, 'A ledger hit must not send a second provider request');
      assert.equal(records.target.state, 'published');
      assert.equal(records.target.remoteId, 'fixture-message-1');
      assert.equal(records.ledger?.responseHash, 'fixture-message-1');
      assert.deepEqual(records.markers.map(({ status }) => status), ['success']);
    } finally {
      await provider.close();
    }
  });
  await check('publish.target: accepted provider outcome survives a persistence fault and blocks blind retry', async () => {
    const fixture = await successfulPublishFixture();
    const provider = await localDiscordProvider(fixture);
    const identifier = randomUUID().replaceAll('-', '');
    const functionName = `l5_publish_fault_${identifier}`;
    const triggerName = `l5_publish_fault_${identifier}`;
    try {
      await admin.query(`CREATE FUNCTION public.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $fault$
        BEGIN
          IF NEW.id = '${fixture.target}'::uuid AND NEW.state = 'published' THEN
            RAISE EXCEPTION 'L5 controlled post-provider persistence fault';
          END IF;
          RETURN NEW;
        END;
      $fault$`);
      await admin.query(`CREATE TRIGGER ${triggerName} BEFORE UPDATE ON public.post_target
        FOR EACH ROW EXECUTE FUNCTION public.${functionName}()`);
      const executors = { ...defaultExecutors, 'publish.target': ctx => publishTarget(ctx, provider.resolver) };
      const outcome = await processJob(fixture.job, executors, 'l5-worker', {});
      await admin.query(`DROP TRIGGER IF EXISTS ${triggerName} ON public.post_target`);
      await admin.query(`DROP FUNCTION IF EXISTS public.${functionName}()`);

      let records = await publishRecords(fixture);
      assert.equal(outcome, 'dead', `Publish executor error: ${safeFixtureError(records.job.lastError)}`);
      assert.equal(provider.deliveries.length, 1,
        `The isolated provider accepted exactly one request; executor error: ${safeFixtureError(records.job.lastError)}`);
      assert.equal(provider.deliveries[0]?.embeds?.[0]?.image?.url, fixture.mediaUrl,
        'The accepted connector payload must include the model-scoped provider media URL');
      assert.equal(records.job.state, 'dead');
      assert.ok(records.job.lastError?.startsWith('external-side-effect-unknown:'));
      assert.equal(records.target.state, 'pending', 'The failed transaction cannot claim local publication');
      assert.equal(records.ledger, null, 'A rolled-back publication cannot leave a success ledger entry');
      assert.deepEqual(records.markers.map(({ status }) => status), ['pending']);

      await assert.rejects(scoped(fixture.org, tx => publishTarget({
        tx, job: fixture.job, workerId: 'l5-worker', killSwitchEnabled: false,
        markExternalSideEffect: () => {},
      }, provider.resolver)), /unresolved dispatch marker .* provider reconciliation required before retry/);
      records = await publishRecords(fixture);
      assert.equal(provider.deliveries.length, 1, 'Unknown provider outcome requires reconciliation before any second send');
      assert.equal(records.markers.length, 1);
      assert.equal(records.markers[0].status, 'pending');
    } finally {
      await admin.query(`DROP TRIGGER IF EXISTS ${triggerName} ON public.post_target`);
      await admin.query(`DROP FUNCTION IF EXISTS public.${functionName}()`);
      await provider.close();
    }
  });
  await check('relay unknown dispatch marker survives and blocks duplicate/replay', async () => {
    const fixture = await relayDispatchFixture();
    const originalCliPath = process.env.SIGNAL_CLI_PATH;
    const originalAccount = process.env.SIGNAL_ACCOUNT;
    process.env.SIGNAL_CLI_PATH = `/tmp/axiom-l5-missing-signal-${process.env.AXIOM_L5_FIXTURE}`;
    process.env.SIGNAL_ACCOUNT = 'fixture-only-account';
    try {
      assert.equal(await processJob(fixture.job, defaultExecutors, 'l5-worker', {}), 'dead');
      let records = await state(fixture);
      assert.equal(records.job.state, 'dead');
      assert.ok(records.job.lastError?.startsWith('external-side-effect-unknown:'), 'dispatch failure must be recorded as unknown');
      assert.equal(records.relayMarkers.length, 1);
      assert.deepEqual(records.relayMarkers.map(({ state, channel, external_ref }) => ({ state, channel, external_ref })), [
        { state: 'pending', channel: 'signal', external_ref: 'l5-fixture-signal-chat' },
      ]);

      await assert.rejects(scoped(fixture.org, tx => defaultExecutors['dlq.replay']({
        tx, workerId: 'l5-worker', killSwitchEnabled: false,
        job: { org_id: fixture.org, payload: { jobId: fixture.job.id } },
      })), /provider reconciliation before retry/);
      await assert.rejects(scoped(fixture.org, tx => defaultExecutors['relay.card']({
        tx, job: fixture.job, workerId: 'l5-worker', killSwitchEnabled: false,
        markExternalSideEffect: () => {},
      })), /unresolved dispatch marker .* provider reconciliation required before retry/);

      records = await state(fixture);
      assert.equal(records.job.state, 'dead');
      assert.ok(records.job.lastError?.startsWith('external-side-effect-unknown:'), 'replay must preserve the unknown outcome');
      assert.equal(records.relayMarkers.length, 1);
      assert.equal(records.relayMarkers[0].state, 'pending');
    } finally {
      if (originalCliPath === undefined) delete process.env.SIGNAL_CLI_PATH;
      else process.env.SIGNAL_CLI_PATH = originalCliPath;
      if (originalAccount === undefined) delete process.env.SIGNAL_ACCOUNT;
      else process.env.SIGNAL_ACCOUNT = originalAccount;
    }
  });
  await check('audit chain round-trips nested JSON through PostgreSQL', async () => {
    const { org } = await tenant();
    await scoped(org, tx => writeAudit(tx, org, 'l5-operator', 'l5.audit', 'fixture', { reason: 'approved', nested: { b: 2, a: [1, true, null] } }));
    const result = await scoped(org, tx => verifyAuditChain(tx, org));
    assert.equal(result.rows, 1); assert.equal(result.valid, true);
    assert.equal(result.fullyVerified, true); assert.equal(result.legacyRows, 0);
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
    assert.equal(result.fullyVerified, true); assert.equal(result.legacyRows, 0);
  });
} finally {
  await pool.end(); await admin.end();
  report.total = report.passed + report.failed + report.skipped;
  console.log(JSON.stringify(report));
  process.exitCode = report.failed ? 1 : 0;
}
