// Runs only inside the owned network-disabled fixture, against real production code.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { db, pool, schema } from '@axiom/db';
import { createConnector } from '@axiom/connectors';
import { sql, eq, and } from 'drizzle-orm';
import { processJob, defaultExecutors, publishTarget, readKillSwitch, workerTick } from '@axiom/worker';
import { CommandRouter } from '@axiom/relay';
import { createCapabilityTokenWithMetadata, Tier } from '@axiom/mcp-server';
import apiApp, { createRelayApp } from './dist/index.js';
import { encryptOAuthCredentials, decryptOAuthCredentials } from './dist/routes/oauth-connection.js';
import { bundlesRouter } from './dist/routes/bundles.js';
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
let credentialApiFixture = null;
function safeFixtureError(error) {
  const message = String(error ?? '');
  return ['AXIOM_L5_DISCORD_WEBHOOK_TOKEN', 'AXIOM_L5_PROVIDER_ACCESS_TOKEN', 'AXIOM_L5_PROVIDER_REFRESH_TOKEN']
    .reduce((value, key) => process.env[key] ? value.replaceAll(process.env[key], '[FIXTURE-REDACTED]') : value, message);
}
function waitWithTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}
function safeChildDiagnostics(output, secrets) {
  let message = Buffer.isBuffer(output) ? output.toString('utf8') : String(output ?? '');
  for (const secret of secrets.filter(value => typeof value === 'string' && value.length > 0)) {
    message = message.replaceAll(secret, '[FIXTURE-REDACTED]');
  }
  message = message.replace(/(postgres(?:ql)?:\/\/[^:@\s/]+:)[^@\s/]+@/gi, '$1[FIXTURE-REDACTED]@');
  return message.slice(-4_000);
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
  await scoped(org, tx => tx.insert(schema.orgSettings).values({ orgId: org, publishingEnabled: true }));
  return { org, model };
}
async function credentialOperatorCookie(org) {
  const email = `l5-${randomUUID()}@fixture.invalid`;
  const password = randomBytes(32).toString('base64url');
  const signup = await apiApp.request(new Request('https://l5-fixture.invalid/api/auth/sign-up/email', {
    method: 'POST',
    headers: { Origin: 'https://l5-fixture.invalid', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name: 'L5 credential fixture operator' }),
  }));
  const signupText = await signup.text();
  assert.equal(signup.status, 200, 'Real Better Auth signup must establish the fixture session');
  const identity = JSON.parse(signupText);
  assert.ok(identity.user?.id, 'Better Auth must return the created fixture identity');
  await admin.query('UPDATE auth_user SET org_id = $1 WHERE id = $2', [org, identity.user.id]);
  const cookies = signup.headers.getSetCookie();
  const cookie = cookies.map(value => value.split(';', 1)[0]).join('; ');
  assert.match(cookie, /session_token=/, 'Signup must return a real session cookie');
  return cookie;
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
function bundleApprovalApp(fixture) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('orgId', fixture.org);
    c.set('userId', 'l5-operator');
    c.set('role', 'owner');
    await next();
  });
  app.route('/', bundlesRouter);
  return app;
}
async function requestBundleApproval(fixture) {
  const body = { platforms: ['discord'] };
  if (fixture.connection) body.connectionIds = { discord: fixture.connection };
  return bundleApprovalApp(fixture).request(`/${fixture.bundle}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
async function assertApprovalRejectedWithoutMutation(fixture, response, expectedDetail) {
  const detail = await response.text();
  assert.equal(response.status, 409, detail);
  assert.ok(detail.includes(expectedDetail), `Expected safe rejection detail ${expectedDetail}: ${detail}`);
  const records = await scoped(fixture.org, async tx => ({
    bundle: (await tx.select().from(schema.contentBundle).where(eq(schema.contentBundle.id, fixture.bundle)))[0],
    targets: await tx.select().from(schema.postTarget).where(eq(schema.postTarget.bundleId, fixture.bundle)),
    publishJobs: await tx.select().from(schema.job).where(and(
      eq(schema.job.orgId, fixture.org), eq(schema.job.kind, 'publish.target'),
    )),
    approvals: await tx.select().from(schema.auditLog).where(and(
      eq(schema.auditLog.orgId, fixture.org), eq(schema.auditLog.action, 'bundle.approve'),
    )),
  }));
  assert.equal(records.bundle.state, 'generated', 'A rejected approval must preserve the reviewable state');
  assert.equal(records.targets.length, 0, 'A rejected approval must not create post targets');
  assert.equal(records.publishJobs.length, 0, 'A rejected approval must not enqueue publishing');
  assert.equal(records.approvals.length, 0, 'A rejected approval must not write a success audit event');
}
async function preparePassingApprovalFixture(fixture, scanState) {
  const connection = randomUUID();
  await scoped(fixture.org, async tx => {
    await tx.update(schema.contentBundle).set({ tosReport: {
      verdict: 'pass', scores: [{ platform: 'discord', score: 0, verdict: 'pass' }],
    } }).where(eq(schema.contentBundle.id, fixture.bundle));
    await tx.insert(schema.consentRecord).values(syntheticConsentRows(fixture.org, fixture.model));
    await tx.insert(schema.platformConnection).values({
      id: connection,
      orgId: fixture.org,
      modelId: fixture.model,
      platform: 'discord',
      displayName: 'L5 isolated approval fixture',
      encToken: randomBytes(32),
      encNonce: randomBytes(12),
      dekId: `l5-${randomUUID()}`,
      capabilities: ['publish'],
      status: 'connected',
    });
    if (scanState === 'failed') {
      await tx.update(schema.job).set({
        state: 'dead',
        attempts: 1,
        lastError: 'L5 controlled scanner failure',
        lockedBy: null,
        lockedAt: null,
        completedAt: new Date(),
      }).where(eq(schema.job.id, fixture.job.id));
    }
  });
  fixture.connection = connection;
  return fixture;
}
async function relayDispatchFixture() {
  const { org, model } = await tenant();
  const bundle = randomUUID(), job = randomUUID();
  await scoped(org, async tx => {
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
async function relayCommandFixture(owner) {
  const { org, model } = owner ?? await tenant();
  const bundle = randomUUID(), card = randomUUID();
  await scoped(org, async tx => {
    await tx.insert(schema.contentBundle).values({ id: bundle, orgId: org, modelId: model,
      state: 'generated', captions: { instagram: 'Synthetic relay command fixture.' }, hashtags: [],
      tosReport: { verdict: 'pending' } });
    await tx.insert(schema.relayCard).values({ id: card, orgId: org, modelId: model, bundleId: bundle,
      channel: 'telegram', externalRef: 'l5-fixture-chat', state: 'sent', title: 'Synthetic review', config: {} });
  });
  return { org, model, bundle, card };
}
async function viralIngestFixture() {
  const { org, model } = await tenant();
  const bundle = randomUUID(), target = randomUUID(), remoteId = `l5-${randomUUID()}`;
  await scoped(org, async tx => {
    await tx.insert(schema.contentBundle).values({ id: bundle, orgId: org, modelId: model,
      state: 'published', captions: { instagram: 'Synthetic published post.' }, hashtags: [],
      tosReport: { verdict: 'pass' } });
    await tx.insert(schema.postTarget).values({ id: target, orgId: org, bundleId: bundle, platform: 'instagram',
      state: 'published', remoteId, publishedAt: new Date(), idemKey: randomBytes(32) });
  });
  return { org, model, bundle, target, remoteId };
}
async function blockedPublishFixture(tosReport) {
  const { org, model } = await tenant();
  const bundle = randomUUID(), target = randomUUID(), job = randomUUID();
  await scoped(org, async tx => {
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
function syntheticConsentRows(org, model) {
  const today = new Date().toISOString().slice(0, 10);
  return ['2257', 'model_release', 'id_verify', 'platform_consent'].map(docKind => ({
    id: randomUUID(), orgId: org, modelId: model, platform: 'discord', consentType: `l5-${docKind}`,
    docKind, granted: true, grantedAt: new Date(Date.now() - 60_000), expiresAt: null, revokedAt: null,
    subjectRef: 'synthetic-l5-fixture', blobRef: `l5-fixture/${docKind}`,
    sha256: randomBytes(32), documentCiphertext: null, documentMimeType: null, documentSize: null,
    validFrom: today, validTo: null,
  }));
}
async function successfulPublishFixture({ includeConsent = true, startReady = false } = {}) {
  const { org, model } = await tenant();
  const asset = randomUUID(), bundle = randomUUID(), target = randomUUID(), job = randomUUID(), connection = randomUUID();
  const idemKey = randomBytes(32);
  const media = readFileSync('/app/var/media/fixture.png');
  const storageKey = 'fixture.png';
  await scoped(org, async tx => {
    await tx.insert(schema.asset).values({ id: asset, orgId: org, modelId: model, kind: 'image',
      fileName: 'fixture.png', mimeType: 'image/png', fileSize: media.length, storageKey,
      sha256: createHash('sha256').update(media).digest() });
    await tx.insert(schema.contentBundle).values({ id: bundle, orgId: org, modelId: model,
      assetId: asset, state: 'approved', captions: { discord: 'Synthetic L5 publish acceptance.' }, hashtags: [],
      tosReport: { verdict: 'pass', scores: [{ platform: 'discord', score: 0, verdict: 'pass' }] } });
    await tx.insert(schema.platformConnection).values({ id: connection, orgId: org, modelId: model,
      platform: 'discord', displayName: 'L5 isolated provider fixture', encToken: randomBytes(32),
      encNonce: randomBytes(12), dekId: `l5-${randomUUID()}`, capabilities: ['publish'], status: 'connected' });
    if (includeConsent) await tx.insert(schema.consentRecord).values(syntheticConsentRows(org, model));
    await tx.insert(schema.postTarget).values({ id: target, orgId: org, bundleId: bundle,
      platform: 'discord', connectionId: connection, state: 'pending', idemKey });
    await tx.insert(schema.job).values([
      { id: randomUUID(), orgId: org, queue: 'media', kind: 'tos.scan', state: 'done',
        payload: { bundleId: bundle }, attempts: 0, maxAttempts: 1 },
      { id: job, orgId: org, queue: 'publish', kind: 'publish.target', state: startReady ? 'ready' : 'running',
        payload: { targetId: target }, attempts: 0, maxAttempts: 1,
        runAfter: new Date(Date.now() - 60_000),
        lockedBy: startReady ? null : 'l5-worker', lockedAt: startReady ? null : new Date() },
    ]);
  });
  const result = await scoped(org, tx => tx.execute(sql`SELECT * FROM job WHERE id=${job}`));
  return { org, model, bundle, target, job: result.rows[0], connection, idemKey,
    mediaUrl: 'https://media.example.invalid/assets/fixture.png' };
}
async function localDiscordProvider(fixture, { holdResponse = false,
  webhookToken = process.env.AXIOM_L5_DISCORD_WEBHOOK_TOKEN } = {}) {
  const deliveries = [];
  let resolveAccepted;
  const accepted = new Promise(resolve => { resolveAccepted = resolve; });
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/publish');
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      deliveries.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      resolveAccepted(deliveries.at(-1));
      if (holdResponse) return;
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
  webhookToken ??= '';
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
    accepted,
    transportPort: address.port,
    resolver,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections?.();
    }),
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
async function assertConsentBlocksPublish(fixture, provider) {
  assert.equal(await processJob(fixture.job, {
    ...defaultExecutors,
    'publish.target': ctx => publishTarget(ctx, provider.resolver),
  }, 'l5-worker', {}), 'dead');

  const records = await publishRecords(fixture);
  assert.equal(provider.deliveries.length, 0, 'Missing or out-of-scope consent must block before provider I/O');
  assert.equal(records.job.state, 'dead');
  assert.match(records.job.lastError, /valid, in-date consent records.*2257/);
  assert.equal(records.target.state, 'pending');
  assert.equal(records.ledger, null);
  assert.equal(records.markers.length, 0, 'Blocked consent cannot create a dispatch marker');
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
  await check('bundles.approve: block, review, and incomplete reports create no publishing work', async () => {
    for (const [tosReport, expectedDetail] of [
      [{ verdict: 'block', scores: [{ platform: 'discord', verdict: 'block' }] }, 'ToS block'],
      [{ verdict: 'review', scores: [{ platform: 'discord', verdict: 'review' }] }, 'ToS check unavailable'],
      [{ verdict: 'pass', scores: [] }, 'ToS check unavailable'],
    ]) {
      const fixture = await jobFixture();
      await scoped(fixture.org, tx => tx.update(schema.contentBundle).set({ tosReport })
        .where(eq(schema.contentBundle.id, fixture.bundle)));
      const response = await requestBundleApproval(fixture);
      await assertApprovalRejectedWithoutMutation(fixture, response, expectedDetail);
    }
  });
  await check('bundles.approve: failed scan cannot approve a passing report', async () => {
    const fixture = await preparePassingApprovalFixture(await jobFixture(), 'failed');
    const response = await requestBundleApproval(fixture);
    await assertApprovalRejectedWithoutMutation(fixture, response, 'ToS scan failed');
  });
  await check('bundles.approve: running scan cannot approve a passing report', async () => {
    const fixture = await preparePassingApprovalFixture(await jobFixture(), 'running');
    const response = await requestBundleApproval(fixture);
    await assertApprovalRejectedWithoutMutation(fixture, response, 'ToS scan is still running');
  });
for (const kind of Object.keys(defaultExecutors)) {
    await check(`${kind}: missing and disabled organization safety state parks queued work`, async () => {
      for (const configured of [false, true]) {
        const fixture = await jobFixture(kind);
        if (configured) {
          await scoped(fixture.org, tx => tx.update(schema.orgSettings).set({ publishingEnabled: false })
            .where(eq(schema.orgSettings.orgId, fixture.org)));
        } else {
          await scoped(fixture.org, tx => tx.delete(schema.orgSettings)
            .where(eq(schema.orgSettings.orgId, fixture.org)));
        }
        assert.equal(await scoped(fixture.org, tx => readKillSwitch(tx, fixture.org)), true);
        assert.equal(await processJob(fixture.job, defaultExecutors, 'l5-worker', {}), 'parked');
        const records = await state(fixture);
        assert.equal(records.job.state, 'ready'); assert.equal(records.job.lockedBy, null);
        assert.equal(records.job.attempts, 0, 'Pausing work must not consume a job attempt');
        assert.match(records.job.lastError, /kill switch/i);
        assert.deepEqual(records.cards.map(card => card.id), kind === 'relay.card' ? [fixture.job.id] : [],
          'Pausing work must not enqueue an additional relay.card job');
        assert.equal(records.relayMarkers.length, 0, 'A paused queue must not create relay outcomes');
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
  await check('publish.target: expired model consent blocks provider dispatch after approval', async () => {
    const fixture = await successfulPublishFixture();
    const provider = await localDiscordProvider(fixture);
    try {
      await scoped(fixture.org, tx => tx.update(schema.consentRecord)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(and(
          eq(schema.consentRecord.orgId, fixture.org),
          eq(schema.consentRecord.modelId, fixture.model),
          eq(schema.consentRecord.docKind, '2257'),
        )));

      await assertConsentBlocksPublish(fixture, provider);
    } finally {
      await provider.close();
    }
  });
  await check('publish.target: missing model consent blocks provider dispatch after approval', async () => {
    const fixture = await successfulPublishFixture({ includeConsent: false });
    const provider = await localDiscordProvider(fixture);
    try {
      const consent = await scoped(fixture.org, tx => tx.select({ id: schema.consentRecord.id })
        .from(schema.consentRecord).where(and(
          eq(schema.consentRecord.orgId, fixture.org), eq(schema.consentRecord.modelId, fixture.model),
        )));
      assert.equal(consent.length, 0, 'Target model must have no consent records');
      await assertConsentBlocksPublish(fixture, provider);
    } finally {
      await provider.close();
    }
  });
  await check('publish.target: sibling-model consent cannot authorize provider dispatch', async () => {
    const fixture = await successfulPublishFixture({ includeConsent: false });
    const provider = await localDiscordProvider(fixture);
    try {
      const siblingModel = randomUUID();
      await admin.query('INSERT INTO model_profile(id,org_id,display_name,handle) VALUES($1,$2,$3,$4)',
        [siblingModel, fixture.org, 'Synthetic sibling talent', siblingModel]);
      await scoped(fixture.org, tx => tx.insert(schema.consentRecord).values(syntheticConsentRows(fixture.org, siblingModel)));
      const siblingConsent = await scoped(fixture.org, tx => tx.select({ id: schema.consentRecord.id })
        .from(schema.consentRecord).where(and(
          eq(schema.consentRecord.orgId, fixture.org), eq(schema.consentRecord.modelId, siblingModel),
        )));
      assert.equal(siblingConsent.length, 4, 'Only the sibling model has the four valid consent records');
      await assertConsentBlocksPublish(fixture, provider);
    } finally {
      await provider.close();
    }
  });
  await check('publish.target: another tenant consent cannot authorize provider dispatch', async () => {
    const fixture = await successfulPublishFixture({ includeConsent: false });
    const provider = await localDiscordProvider(fixture);
    try {
      const otherTenant = await tenant();
      await scoped(otherTenant.org, tx => tx.insert(schema.consentRecord).values(
        syntheticConsentRows(otherTenant.org, otherTenant.model),
      ));
      const otherConsent = await scoped(otherTenant.org, tx => tx.select({ id: schema.consentRecord.id })
        .from(schema.consentRecord).where(and(
          eq(schema.consentRecord.orgId, otherTenant.org), eq(schema.consentRecord.modelId, otherTenant.model),
        )));
      assert.equal(otherConsent.length, 4, 'The other tenant has a separate complete synthetic consent set');
      await assertConsentBlocksPublish(fixture, provider);
    } finally {
      await provider.close();
    }
  });
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
  await check('publish.target: killed worker preserves the accepted marker and stale recovery blocks redispatch', async () => {
    const fixture = await successfulPublishFixture({ startReady: true });
    const webhookToken = randomBytes(32).toString('hex');
    const provider = await localDiscordProvider(fixture, { holdResponse: true, webhookToken });
    let child;
    try {
      const childSource = `
        import assert from 'node:assert/strict';
        import { createConnector } from '@axiom/connectors';
        import { defaultExecutors, publishTarget, workerTick } from '@axiom/worker';
        const token = process.env.AXIOM_L5_DISCORD_WEBHOOK_TOKEN;
        const port = Number(process.env.AXIOM_L5_DISCORD_TRANSPORT_PORT);
        const auth = { accessToken: '', extra: {
          webhookUrl: 'https://discord.com/api/webhooks/123456789012345678/' + token,
          discordChannelId: '123456789012345678',
        } };
        const transport = async (providerUrl, init) => {
          console.error('l5-crash-worker: provider transport invoked');
          const url = new URL(String(providerUrl));
          assert.equal(url.protocol, 'https:');
          assert.equal(url.hostname, 'discord.com');
          assert.equal(url.pathname.split('/').at(-1), token);
          assert.equal(url.searchParams.get('wait'), 'true');
          return fetch('http://127.0.0.1:' + port + '/publish', { ...init, redirect: 'error' });
        };
        const resolver = async (_tx, orgId, modelId, target) => {
          console.error('l5-crash-worker: connector resolver invoked');
          assert.equal(orgId, process.env.AXIOM_L5_ORG_ID);
          assert.equal(modelId, process.env.AXIOM_L5_MODEL_ID);
          assert.equal(target.platform, 'discord');
          assert.equal(target.connectionId, process.env.AXIOM_L5_CONNECTION_ID);
          return { connection: { id: process.env.AXIOM_L5_CONNECTION_ID },
            connector: createConnector('discord', auth, transport) };
        };
        console.error('l5-crash-worker: worker tick starting');
        try {
          const stats = await workerTick({ workerId: 'l5-crash-worker', egressScope: { modelId: process.env.AXIOM_L5_MODEL_ID },
            executors: { ...defaultExecutors, 'publish.target': ctx => publishTarget(ctx, resolver) } });
          console.error('l5-crash-worker: worker tick returned claimed=' + stats.claimed + ' done=' + stats.done);
        } catch (error) {
          console.error('l5-crash-worker: worker tick failed type=' + (error?.name ?? 'Error') + ' code=' + (error?.code ?? 'none'));
          process.exitCode = 1;
        }
      `;
      const childEnv = {
        PATH: process.env.PATH,
        NODE_ENV: process.env.NODE_ENV,
        DATABASE_URL: process.env.DATABASE_URL,
        AXIOM_L5_FIXTURE: process.env.AXIOM_L5_FIXTURE,
        AXIOM_L5_ORG_ID: fixture.org,
        AXIOM_L5_MODEL_ID: fixture.model,
        AXIOM_L5_CONNECTION_ID: fixture.connection,
        AXIOM_L5_DISCORD_WEBHOOK_TOKEN: webhookToken,
        AXIOM_L5_DISCORD_TRANSPORT_PORT: String(provider.transportPort),
        AXIOM_ASSET_DELIVERY_BASE_URL: process.env.AXIOM_ASSET_DELIVERY_BASE_URL,
        MEDIA_PLANE_URL: process.env.MEDIA_PLANE_URL,
        MEDIA_PLANE_AUTH_TOKEN: process.env.MEDIA_PLANE_AUTH_TOKEN,
      };
      child = spawn(process.execPath, ['--input-type=module', '-e', childSource], {
        cwd: process.cwd(), env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      });
      let childOutput = Buffer.alloc(0);
      const captureChildOutput = chunk => {
        childOutput = Buffer.concat([childOutput, chunk]).subarray(-16_384);
      };
      child.stdout.on('data', captureChildOutput);
      child.stderr.on('data', captureChildOutput);
      const exitedBeforeAcceptance = new Promise((_, reject) => {
        child.once('error', error => reject(new Error(`Crash fixture worker could not start: ${error.message}`)));
        child.once('exit', (code, signal) => reject(new Error(`Crash fixture worker exited before provider acceptance (${code}/${signal})`)));
      });
      let acceptedPayload;
      try {
        acceptedPayload = await waitWithTimeout(Promise.race([provider.accepted, exitedBeforeAcceptance]),
          15_000, 'Crash fixture worker did not reach the local provider');
      } catch (error) {
        let rowState = 'database readback unavailable';
        try {
          const records = await waitWithTimeout(publishRecords(fixture), 5_000, 'fixture readback timeout');
          rowState = `job=${records.job.state}/${records.job.lockedBy ?? 'unlocked'} target=${records.target.state} `
            + `dispatch=${records.markers.map(({ status }) => status).join(',') || 'none'} ledger=${records.ledger ? 'present' : 'absent'}`;
        } catch { /* preserve the original worker/transport failure */ }
        const childDetails = safeChildDiagnostics(childOutput,
          [webhookToken, process.env.DATABASE_URL]);
        throw new Error(`${error.message}; ${rowState}${childDetails ? `; child output: ${childDetails}` : ''}`);
      }
      assert.equal(provider.deliveries.length, 1, 'The local provider accepted one in-flight publish request');
      assert.equal(acceptedPayload?.embeds?.[0]?.image?.url, fixture.mediaUrl,
        'The real connector payload must include the model-scoped provider media URL');

      let records = await publishRecords(fixture);
      assert.equal(records.job.state, 'running');
      assert.equal(records.job.lockedBy, 'l5-crash-worker');
      assert.equal(records.target.state, 'pending', 'Local publication cannot commit while the provider response is withheld');
      assert.equal(records.ledger, null, 'A pending remote operation cannot be recorded as a completed outcome');
      assert.deepEqual(records.markers.map(({ status }) => status), ['pending'],
        'The reconciliation anchor commits before the provider request');

      const killed = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
      assert.equal(child.kill('SIGKILL'), true, 'The active isolated worker process must be killable');
      assert.deepEqual(await waitWithTimeout(killed, 10_000, 'Killed fixture worker did not exit'),
        { code: null, signal: 'SIGKILL' });

      records = await publishRecords(fixture);
      assert.equal(records.job.state, 'running', 'A process crash leaves recovery to the durable lease path');
      assert.equal(records.target.state, 'pending');
      assert.equal(records.ledger, null);
      assert.deepEqual(records.markers.map(({ status }) => status), ['pending']);

      const aged = await admin.query(`UPDATE job SET locked_at = now() - interval '16 minutes'
        WHERE id = $1 AND org_id = $2 AND state = 'running' AND locked_by = 'l5-crash-worker'`, [fixture.job.id, fixture.org]);
      assert.equal(aged.rowCount, 1, 'Only the synthetic crash fixture lease may be aged');
      const recovery = await workerTick({ workerId: 'l5-recovery-worker', egressScope: { modelId: fixture.model } });
      assert.equal(recovery.claimed, 0, 'Stale external work is dead-lettered instead of reclaimed for a second dispatch');
      assert.equal(recovery.emptyPolls, 1);

      records = await publishRecords(fixture);
      assert.equal(records.job.state, 'dead');
      assert.ok(records.job.lastError?.startsWith('external-side-effect-unknown:'),
        'Recovery must record that the provider outcome is unknown');
      assert.equal(records.target.state, 'pending');
      assert.equal(records.ledger, null);
      assert.deepEqual(records.markers.map(({ status }) => status), ['pending']);
      await assert.rejects(scoped(fixture.org, tx => publishTarget({
        tx, job: fixture.job, workerId: 'l5-recovery-worker', killSwitchEnabled: false,
        markExternalSideEffect: () => {},
      }, provider.resolver)), /unresolved dispatch marker .* provider reconciliation required before retry/);
      assert.equal(provider.deliveries.length, 1, 'Neither recovery nor a manual executor retry may send a second request');
      records = await publishRecords(fixture);
      assert.equal(records.markers.length, 1);
      assert.equal(records.markers[0].status, 'pending');
    } finally {
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        const exited = new Promise(resolve => child.once('exit', resolve));
        child.kill('SIGKILL');
        await waitWithTimeout(exited, 10_000, 'Crash fixture worker cleanup timed out').catch(() => {});
      }
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
  await check('real egress encryption persists provider credentials as ciphertext and authenticated social APIs redact them', async () => {
    const accessToken = process.env.AXIOM_L5_PROVIDER_ACCESS_TOKEN;
    const refreshToken = process.env.AXIOM_L5_PROVIDER_REFRESH_TOKEN;
    assert.ok(accessToken && refreshToken && accessToken !== refreshToken, 'Distinct generated provider credential fixtures are required');
    const fixture = await tenant();
    const cookie = await credentialOperatorCookie(fixture.org);
    const credentials = {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    };
    const envelope = await encryptOAuthCredentials(credentials);
    assert.ok(envelope.encToken.length > 32, 'Real egress encryption must return authenticated ciphertext');
    assert.equal(envelope.encNonce.length, 24, 'XChaCha20-Poly1305 envelope nonce must be 24 bytes');
    assert.deepEqual(await decryptOAuthCredentials(envelope), credentials, 'The stored envelope must round-trip through the real egress plane');

    const url = `https://l5-fixture.invalid/api/v1/social-accounts?modelId=${encodeURIComponent(fixture.model)}`;
    const headers = { Origin: 'https://l5-fixture.invalid', Cookie: cookie };
    let apiOutput = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk) => {
      apiOutput += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      return true;
    });
    let createdText;
    let listedText;
    try {
      const anonymous = await apiApp.request(new Request(url));
      assert.equal(anonymous.status, 401, 'Social account API must retain its authentication boundary');
      const created = await apiApp.request(new Request(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({
          platform: 'instagram', displayName: 'L5 synthetic encrypted provider',
          encToken: Buffer.from(envelope.encToken).toString('base64'),
          encNonce: Buffer.from(envelope.encNonce).toString('base64'), dekId: envelope.dekId,
        }),
      }));
      createdText = await created.text();
      assert.equal(created.status, 201, 'Authenticated API must persist a ciphertext envelope');
      const createdBody = JSON.parse(createdText);
      assert.ok(createdBody.data?.id, 'API must return the new connection identity');
      for (const field of ['encToken', 'encNonce', 'dekId', 'accessToken', 'refreshToken']) {
        assert.equal(Object.hasOwn(createdBody.data, field), false, `POST response must omit ${field}`);
      }

      const listed = await apiApp.request(new Request(url, { headers }));
      listedText = await listed.text();
      assert.equal(listed.status, 200, 'Authenticated API must read the saved connection');
      const listedBody = JSON.parse(listedText);
      const listedConnection = listedBody.data.find(entry => entry.id === createdBody.data.id);
      assert.ok(listedConnection, 'GET response must include the saved connection metadata');
      for (const field of ['encToken', 'encNonce', 'dekId', 'accessToken', 'refreshToken']) {
        assert.equal(Object.hasOwn(listedConnection, field), false, `GET response must omit ${field}`);
      }

      const stored = await admin.query(
        'SELECT enc_token, enc_nonce, dek_id FROM platform_connection WHERE id = $1 AND org_id = $2',
        [createdBody.data.id, fixture.org],
      );
      assert.equal(stored.rowCount, 1, 'The envelope must be persisted under the fixture tenant');
      const ciphertext = Buffer.from(stored.rows[0].enc_token);
      assert.equal(ciphertext.includes(Buffer.from(accessToken)), false, 'Database credential bytes must not contain the access token');
      assert.equal(ciphertext.includes(Buffer.from(refreshToken)), false, 'Database credential bytes must not contain the refresh token');
      assert.deepEqual(await decryptOAuthCredentials({
        encToken: new Uint8Array(stored.rows[0].enc_token),
        encNonce: new Uint8Array(stored.rows[0].enc_nonce), dekId: stored.rows[0].dek_id,
      }), credentials, 'The persisted bytes must decrypt to the original fixture credentials');

      const audit = await admin.query(
        'SELECT detail::text AS detail FROM audit_log WHERE org_id = $1 AND action = $2 AND target = $3',
        [fixture.org, 'social.connect', createdBody.data.id],
      );
      assert.equal(audit.rowCount, 1, 'Connection audit event must be durable');
      assert.equal(audit.rows[0].detail.includes(accessToken), false, 'Audit detail must not contain access credentials');
      assert.equal(audit.rows[0].detail.includes(refreshToken), false, 'Audit detail must not contain refresh credentials');
      assert.equal(apiOutput.includes(accessToken), false, 'API logs must not contain the access token');
      assert.equal(apiOutput.includes(refreshToken), false, 'API logs must not contain the refresh token');
      assert.equal(createdText.includes(accessToken) || listedText.includes(accessToken), false, 'API JSON must not contain provider credentials');
      assert.equal(createdText.includes(refreshToken) || listedText.includes(refreshToken), false, 'API JSON must not contain provider credentials');
      credentialApiFixture = { ...fixture, connectionId: createdBody.data.id };
    } finally {
      process.stdout.write = originalWrite;
    }
  });
  await check('signed Relay API command persists one safe mutation and rejects forged, expired, foreign-signer, and replayed signatures', async () => {
    assert.ok(credentialApiFixture, 'Credential API fixture must succeed before Relay confidentiality check');
    const fixture = await relayCommandFixture(credentialApiFixture);
    const app = createRelayApp();
    const signer = new CommandRouter(process.env.RELAY_SECRET, 5);
    const requestCommand = (signature, nonce) => app.request('/api/v1/relay/command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature, nonce, action: 'hold', cardId: fixture.card }),
    });
    const nonce = signer.generateNonce();
    const signature = signer.signCommand(nonce, 'hold', fixture.card);
    let acceptedOutput = '';
    const originalAcceptedWrite = process.stdout.write;
    process.stdout.write = ((chunk) => {
      acceptedOutput += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      return true;
    });
    let accepted;
    try {
      accepted = await requestCommand(signature, nonce);
    } finally {
      process.stdout.write = originalAcceptedWrite;
    }
    const acceptedText = await accepted.text();
    assert.equal(accepted.status, 200);
    assert.equal(JSON.parse(acceptedText).success, true);
    assert.equal(acceptedText.includes(process.env.AXIOM_L5_PROVIDER_ACCESS_TOKEN), false, 'Relay response must omit provider access credentials');
    assert.equal(acceptedText.includes(process.env.AXIOM_L5_PROVIDER_REFRESH_TOKEN), false, 'Relay response must omit provider refresh credentials');
    assert.equal(acceptedOutput.includes(process.env.AXIOM_L5_PROVIDER_ACCESS_TOKEN), false, 'Relay logs must omit provider access credentials');
    assert.equal(acceptedOutput.includes(process.env.AXIOM_L5_PROVIDER_REFRESH_TOKEN), false, 'Relay logs must omit provider refresh credentials');

    let rejectedOutput = '';
    let foreignNonce;
    let foreignSignature;
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk) => {
      rejectedOutput += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      return true;
    });
    try {
      assert.equal((await requestCommand(signature, nonce)).status, 403, 'same nonce cannot be replayed');
      const duplicateNonce = signer.generateNonce();
      const duplicate = await requestCommand(signer.signCommand(duplicateNonce, 'hold', fixture.card), duplicateNonce);
      assert.equal(duplicate.status, 200, 'durable duplicate is acknowledged without a second mutation');
      assert.match((await duplicate.json()).error, /already processed/);

      const foreignSigner = new CommandRouter(randomBytes(32).toString('hex'), 5);
      foreignNonce = foreignSigner.generateNonce();
      foreignSignature = foreignSigner.signCommand(foreignNonce, 'hold', fixture.card);
      assert.equal((await requestCommand(foreignSignature, foreignNonce)).status, 403,
        'a well-formed command signed with another installation secret must be rejected');

      const forgedNonce = signer.generateNonce();
      assert.equal((await requestCommand('f'.repeat(64), forgedNonce)).status, 403);
      const expiredBytes = randomBytes(16);
      expiredBytes.writeUInt32BE(Math.floor(Date.now() / 1000) - 301, 0);
      const expiredNonce = expiredBytes.toString('hex');
      assert.equal((await requestCommand(signer.signCommand(expiredNonce, 'hold', fixture.card), expiredNonce)).status, 403);
    } finally {
      process.stdout.write = originalWrite;
    }

    assert.ok(rejectedOutput.includes('Rejected relay command signature'));
    assert.equal((rejectedOutput.match(/"message":"Rejected relay command signature"/g) ?? []).length, 4,
      'nonce replay, foreign-signer, forged, and expired signatures must each be logged');
    assert.ok(!rejectedOutput.includes(fixture.card), 'rejection logs must omit card identifiers');
    assert.ok(!rejectedOutput.includes(nonce), 'rejection logs must omit the replayed nonce');
    assert.ok(!rejectedOutput.includes(signature), 'rejection logs must omit the command signature');
    assert.ok(!rejectedOutput.includes(foreignNonce), 'rejection logs must omit the foreign signer nonce');
    assert.ok(!rejectedOutput.includes(foreignSignature), 'rejection logs must omit the foreign signer signature');
    const records = await scoped(fixture.org, async tx => ({
      bundle: (await tx.select().from(schema.contentBundle).where(eq(schema.contentBundle.id, fixture.bundle)))[0],
      cards: await tx.select().from(schema.relayCommand).where(eq(schema.relayCommand.cardId, fixture.card)),
      jobs: await tx.select().from(schema.job).where(eq(schema.job.orgId, fixture.org)),
      audit: await verifyAuditChain(tx, fixture.org),
    }));
    assert.equal(records.bundle.state, 'hold');
    assert.equal(records.cards.length, 1);
    assert.equal(records.jobs.filter(job => job.kind === 'publish.target').length, 0);
    assert.equal(records.audit.rows, 1);
    assert.equal(records.audit.valid, true);
  });
  await check('MCP publishing enforces tier and waits for human approval without dispatch', async () => {
    const fixture = await tenant();
    const otherModel = randomUUID();
    await admin.query('INSERT INTO model_profile(id,org_id,display_name,handle) VALUES($1,$2,$3,$4)',
      [otherModel, fixture.org, 'Synthetic sibling talent', otherModel]);

    async function issueMcpToken(tier) {
      const agentRef = `l5-${tier}-${randomUUID()}`;
      const permissionId = randomUUID();
      const issued = createCapabilityTokenWithMetadata(fixture.model, tier, agentRef);
      await scoped(fixture.org, async tx => {
        await tx.insert(schema.agentPermission).values({
          id: permissionId,
          orgId: fixture.org,
          modelId: fixture.model,
          agentRef,
          tier,
          canPublish: tier === Tier.Manager || tier === Tier.Autonomous,
        });
        await tx.insert(schema.mcpCapabilityToken).values({
          tokenId: issued.tokenId,
          orgId: fixture.org,
          permissionId,
          modelId: fixture.model,
          agentRef,
          tier,
          expiresAt: new Date(issued.expiresAt),
        });
      });
      return issued.token;
    }

    async function callPublishingTool(token, modelId = fixture.model) {
      const response = await apiApp.request('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: randomUUID(),
          method: 'tools/call',
          params: {
            name: 'publishing_post',
            arguments: {
              modelId,
              action: 'publish',
              post: { platform: 'x', text: 'Synthetic approval-boundary fixture.' },
            },
          },
        }),
      });
      assert.equal(response.status, 200, 'authenticated MCP tool calls use the JSON-RPC transport');
      return response.json();
    }

    for (const tier of [Tier.Viewer, Tier.Operator]) {
      const token = await issueMcpToken(tier);
      const denied = await callPublishingTool(token);
      assert.equal(denied.result?.isError, true, `${tier} cannot invoke publishing_post`);
      assert.equal(denied.result?.content?.[0]?.text,
        'Tool call failed. Check the AXIOM dashboard for status.', 'denial response hides internal permission details');
    }

    const managerToken = await issueMcpToken(Tier.Manager);
    const crossModel = await callPublishingTool(managerToken, otherModel);
    assert.equal(crossModel.result?.isError, true, 'a model-scoped token cannot target a sibling model');
    assert.equal(crossModel.result?.content?.[0]?.text,
      'Tool call failed. Check the AXIOM dashboard for status.', 'model-scope denial hides internal identifiers');

    const bundleIds = [];
    for (const tier of [Tier.Manager, Tier.Autonomous]) {
      const token = tier === Tier.Manager ? managerToken : await issueMcpToken(tier);
      const accepted = await callPublishingTool(token);
      assert.equal(accepted.result?.isError, false, `${tier} may request publication`);
      const result = JSON.parse(accepted.result.content[0].text);
      assert.equal(result.requiresApproval, true);
      assert.equal(result.status, 'pending_approval');
      assert.equal(result.action, 'publish');
      bundleIds.push(result.bundleId);
    }

    const records = await scoped(fixture.org, async tx => ({
      bundles: await tx.select().from(schema.contentBundle).where(eq(schema.contentBundle.orgId, fixture.org)),
      targets: await tx.select().from(schema.postTarget).where(eq(schema.postTarget.orgId, fixture.org)),
      jobs: await tx.select().from(schema.job).where(eq(schema.job.orgId, fixture.org)),
      audit: await verifyAuditChain(tx, fixture.org),
    }));
    assert.deepEqual(records.bundles.map(bundle => bundle.id).sort(), bundleIds.sort());
    assert.ok(records.bundles.every(bundle => bundle.state === 'generated'
      && bundle.publishIntent?.action === 'publish'), 'approved-tier requests remain generated and unapproved');
    assert.equal(records.targets.length, 0, 'agent requests must not create post targets');
    assert.equal(records.jobs.filter(job => job.kind === 'publish.target').length, 0,
      'agent requests must not enqueue external dispatch');
    assert.equal(records.jobs.filter(job => job.kind === 'tos.scan').length, 2,
      'each request only schedules the required ToS scan');
    assert.equal(records.jobs.length, 2, 'no other jobs are created by an agent publishing request');
    assert.equal(records.audit.rows, 5, 'all denied, model-mismatched, and approved requests are audited');
    assert.equal(records.audit.valid, true, 'MCP authorization audit chain remains valid');
  });
  await check('Relay metrics ingest is authenticated, durable, and never queues publishing', async () => {
    const fixture = await viralIngestFixture();
    const app = createRelayApp();
    const body = { postId: fixture.remoteId, metrics: {
      postId: fixture.remoteId, platform: 'instagram', modelName: 'synthetic-l5', impressions: 100,
      likes: 5, comments: 1, shares: 1, saves: 2, engagementRate: 0.09, timestamp: Date.now(),
    } };
    assert.equal((await app.request('/api/v1/viral/ingest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })).status, 401, 'unscoped Relay ingest must not write metrics');
    const authenticated = new Hono();
    authenticated.use('/api/v1/viral/ingest', async (c, next) => {
      c.set('orgId', fixture.org);
      await next();
    });
    authenticated.route('/', app);
    const response = await authenticated.request('/api/v1/viral/ingest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.success, true);
    assert.ok(['viral', 'strong', 'baseline', 'weak'].includes(result.label));
    const records = await scoped(fixture.org, async tx => ({
      target: (await tx.select().from(schema.postTarget).where(eq(schema.postTarget.id, fixture.target)))[0],
      metrics: await tx.select().from(schema.postMetric).where(eq(schema.postMetric.postTargetId, fixture.target)),
      jobs: await tx.select().from(schema.job).where(eq(schema.job.orgId, fixture.org)),
    }));
    assert.equal(records.target.state, 'published');
    assert.equal(records.target.remoteId, fixture.remoteId);
    assert.equal(records.metrics.length, 1);
    assert.equal(records.metrics[0].source, 'manual');
    assert.equal(records.jobs.filter(job => job.kind === 'viral.label').length, 1);
    assert.equal(records.jobs.filter(job => job.kind === 'publish.target').length, 0);
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
    assert.equal(result.rows, 12, JSON.stringify(result));
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.fullyVerified, true, JSON.stringify(result));
    assert.equal(result.legacyRows, 0, JSON.stringify(result));
  });
} finally {
  await pool.end(); await admin.end();
  report.total = report.passed + report.failed + report.skipped;
  console.log(JSON.stringify(report));
  process.exitCode = report.failed ? 1 : 0;
}
