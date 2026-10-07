// HTTP integration probe for disposable local/CI databases only. Creates one
// synthetic user; database teardown removes it. This does not claim browser
// cookie/TLS coverage: CI supplies the configured HTTPS Origin over loopback.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

function loopbackOrigin(input) {
  const url = new URL(input);
  assert.ok(['http:', 'https:'].includes(url.protocol), 'HTTP(S) required');
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
    'Disposable loopback target required',
  );
  assert.ok(
    !url.username && !url.password && !url.search && !url.hash && url.pathname === '/',
    'Only a plain origin is accepted',
  );
  return url.origin;
}

const base = loopbackOrigin(process.argv[2] ?? 'http://127.0.0.1:3002');
const origin = loopbackOrigin(process.argv[3] ?? base);
const tenantFixture = process.argv[4] === '--tenant-fixture';
const waitForToS = process.argv[5] === '--wait-for-tos';
assert.ok(!waitForToS || tenantFixture, 'Worker handoff probe requires the disposable tenant fixture');
let fixtureDatabase;
if (tenantFixture) {
  assert.equal(process.env.CI, 'true', 'Tenant fixture requires explicit CI mode');
  const testedSha = process.env.GITHUB_SHA;
  if (testedSha) {
    assert.match(testedSha, /^[a-f0-9]{40}$/i, 'CI source SHA must be a full commit hash');
    const checkout = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5_000 });
    assert.equal(checkout.status, 0, 'CI checkout SHA must be readable');
    assert.equal(checkout.stdout.trim(), testedSha, 'CI smoke must execute against the event SHA');
    console.log(`auth smoke source SHA: ${testedSha}`);
  }
  fixtureDatabase = new URL(process.env.MIGRATOR_DATABASE_URL ?? '');
  assert.ok(['postgres:', 'postgresql:'].includes(fixtureDatabase.protocol));
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(fixtureDatabase.hostname));
  assert.equal(fixtureDatabase.pathname, '/axiom_test', 'Only the disposable test database is allowed');
  assert.ok(!fixtureDatabase.search && !fixtureDatabase.hash, 'Database options are not allowed');
}
async function request(path, init = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
}
const login = await request('/login');
assert.equal(login.status, 200, 'dashboard login status');
assert.match(await login.text(), /Enter your studio/);
const denied = await request('/api/v1/models');
assert.equal(denied.status, 401, 'anonymous API requests must be denied');

const email = `ci-${randomBytes(12).toString('hex')}@example.invalid`;
const password = randomBytes(24).toString('base64url');
const headers = { 'content-type': 'application/json', origin };
const injectedSignup = await request('/api/auth/sign-up/email', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    email,
    password,
    name: 'Disposable CI Operator',
    // Deliberate privilege-injection attempt: reject the entire request.
    orgId: '11111111-1111-4111-8111-111111111111',
    role: 'owner',
  }),
});
assert.equal(injectedSignup.status, 400, 'signup must reject server-assigned privilege fields');
const signup = await request('/api/auth/sign-up/email', {
  method: 'POST',
  headers,
  body: JSON.stringify({ email, password, name: 'Disposable CI Operator' }),
});
assert.equal(signup.status, 200, 'signup must persist using the runtime database role');
const signin = await request('/api/auth/sign-in/email', {
  method: 'POST',
  headers,
  body: JSON.stringify({ email, password }),
});
assert.equal(signin.status, 200, 'signin status');
const sessionCookies = signin.headers.getSetCookie();
assert.ok(sessionCookies.length > 0, 'signin must set session cookies');
assert.ok(
  sessionCookies.some((value) => /;\s*HttpOnly(?:;|$)/i.test(value)),
  'session must be HttpOnly',
);
const cookie = sessionCookies.map((value) => value.split(';')[0]).join('; ');
const session = await request('/api/auth/get-session', { headers: { cookie } });
assert.equal(session.status, 200, 'session lookup status');
const data = await session.json();
assert.equal(data?.user?.email, email, 'session must restore the signed-in user');
assert.ok(!data.user.orgId, 'public signup cannot assign an organization');
assert.equal(data.user.role, 'operator', 'ordinary signup retains the database default role');
const unassigned = await request('/api/v1/models', { headers: { cookie } });
assert.equal(unassigned.status, 401, 'unassigned identities cannot read tenant data');
const workspace = await request('/', { headers: { cookie } });
assert.equal(workspace.status, 200, 'unassigned identity gets an actionable dashboard response');
assert.match(await workspace.text(), /Workspace access pending/);
if (tenantFixture) {
  // Test-only administrative fixture, never a production provisioning path.
  // Bind variables through psql quoting; do not print credentials or SQL errors.
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const otherModelId = randomUUID();
  const fixture = spawnSync('psql', [
    '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href,
    '-v', 'ON_ERROR_STOP=1', '-v', `fixture_email=${email}`, '-v', `fixture_org=${orgId}`,
    '-v', `other_org=${otherOrgId}`, '-v', `other_model=${otherModelId}`,
  ], {
    encoding: 'utf8', timeout: 10_000,
    input: `BEGIN;
INSERT INTO org (id, name, slug) VALUES (:'fixture_org', 'Disposable HTTP smoke', :'fixture_org');
INSERT INTO org (id, name, slug) VALUES (:'other_org', 'Other disposable tenant', :'other_org');
INSERT INTO model_profile (id, org_id, display_name, handle) VALUES (:'other_model', :'other_org', 'Other tenant private profile', :'other_model');
UPDATE auth_user SET org_id = :'fixture_org' WHERE email = :'fixture_email' AND org_id IS NULL;
SELECT count(*) FROM auth_user WHERE email = :'fixture_email' AND org_id = :'fixture_org' AND role = 'operator';
COMMIT;
`,
  });
  assert.equal(fixture.status, 0, 'Disposable tenant fixture must apply successfully');
  assert.equal(fixture.stdout.trim(), '1', 'Fixture must assign exactly the synthetic operator');
  const assigned = await request('/api/auth/get-session', { headers: { cookie } });
  assert.equal(assigned.status, 200);
  assert.equal((await assigned.json())?.user?.orgId, orgId);
  const modelBody = JSON.stringify({ displayName: 'HTTP smoke profile', handle: `ci-${randomBytes(8).toString('hex')}` });
  const missingKey = await request('/api/v1/models', { method: 'POST', headers: { ...headers, cookie }, body: modelBody });
  assert.equal(missingKey.status, 400, 'Profile creation must require an idempotency key');
  const mutationHeaders = { ...headers, cookie, 'Idempotency-Key': randomUUID() };
  const created = await request('/api/v1/models', { method: 'POST', headers: mutationHeaders, body: modelBody });
  assert.equal(created.status, 201, 'Assigned runtime-role operator can create a profile');
  const createdBody = await created.json();
  assert.ok(createdBody.data?.id);
  assert.equal(createdBody.data.characterLockPrompt, '');
  assert.equal(createdBody.data.characterLockVersion, 0);
  const lockPath = `/api/v1/models/${createdBody.data.id}`;
  const lockIntents = [0, 1].map(index => ({
    method: 'PATCH', headers: { ...headers, cookie, 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ characterLockPrompt: `Saved fixture identity ${index}`, characterLockVersion: 0 }),
  }));
  const lockResponses = await Promise.all(lockIntents.map(intent => request(lockPath, intent)));
  assert.deepEqual(lockResponses.map(response => response.status).sort(), [200, 409],
    'Concurrent character lock saves must have exactly one winner');
  const winningIndex = lockResponses.findIndex(response => response.status === 200);
  const savedLock = (await lockResponses[winningIndex].json()).data;
  assert.equal(savedLock.characterLockVersion, 1);
  assert.equal(savedLock.characterLockPrompt, `Saved fixture identity ${winningIndex}`);
  const lockReplay = await request(lockPath, lockIntents[winningIndex]);
  assert.equal(lockReplay.status, 200, 'Replaying a successful save must not increment the version');
  assert.equal((await lockReplay.json()).data.characterLockVersion, 1);
  const lockReadback = await request(lockPath, { headers: { cookie } });
  assert.equal(lockReadback.status, 200);
  assert.equal((await lockReadback.json()).data.characterLockPrompt, savedLock.characterLockPrompt);
  console.log('character lock HTTP smoke: concurrent winner, durable readback and idempotent replay passed');
  // Real 16x16 blue PNG generated with FFmpeg, plus a private trailer. The
  // running API must sanitize it using its packaged decoder and persist it.
  const uploadBytes = Buffer.concat([
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAABAAAAAQBPJcTWAAAAI0lEQVR4nGNkYPjHQApgIUk1w6gG4gALkergYFQDMYDkUAIAaRMBPMpWW/QAAAAASUVORK5CYII=', 'base64'),
    Buffer.from('disposable-private-upload-marker'),
  ]);
  const uploadIntent = { method: 'POST', body: uploadBytes,
    headers: { origin, cookie, 'content-type': 'image/png', 'Idempotency-Key': randomUUID() } };
  const uploadPath = `/api/v1/models/${createdBody.data.id}/media-upload?sanitize=true`;
  const uploaded = await request(uploadPath, uploadIntent);
  assert.equal(uploaded.status, 201, 'Packaged API must sanitize and store an uploaded image');
  const uploadedAsset = (await uploaded.json()).data;
  assert.ok(uploadedAsset.id);
  assert.equal(uploadedAsset.mimeType, 'image/png');
  assert.equal(uploadedAsset.sanitized, true);
  assert.equal(uploadedAsset.exactFileHashChanged, true);
  assert.equal(uploadedAsset.tosStatus, 'not-scanned', 'Upload alone must not claim content approval');
  const uploadReplay = await request(uploadPath, uploadIntent);
  assert.equal(uploadReplay.status, 201);
  assert.equal((await uploadReplay.json()).data.id, uploadedAsset.id);
  const uploadDuplicate = await request(uploadPath, { ...uploadIntent,
    headers: { ...uploadIntent.headers, 'Idempotency-Key': randomUUID() } });
  assert.equal(uploadDuplicate.status, 201, 'Same-model duplicate content must resolve without another asset');
  assert.equal((await uploadDuplicate.json()).data.id, uploadedAsset.id);
  const sourceImages = await request(`/api/v1/models/${createdBody.data.id}/media-source-images`, { headers: { cookie } });
  assert.equal(sourceImages.status, 200);
  assert.equal((await sourceImages.json()).data.filter(asset => asset.id === uploadedAsset.id).length, 1);
  const foreignUpload = await request(`/api/v1/models/${otherModelId}/media-upload?sanitize=true`, {
    ...uploadIntent, headers: { ...uploadIntent.headers, 'Idempotency-Key': randomUUID() },
  });
  assert.equal(foreignUpload.status, 404, 'An upload cannot target another tenant model');
  // Bind only this synthetic upload to a disposable bundle to exercise the
  // actual authenticated media endpoint. This is not provider-generation proof.
  const previewBundle = randomUUID();
  const previewFixture = spawnSync('psql', [
    '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href, '-v', 'ON_ERROR_STOP=1',
    '-v', `fixture_org=${orgId}`, '-v', `fixture_model=${createdBody.data.id}`,
    '-v', `fixture_asset=${uploadedAsset.id}`, '-v', `fixture_bundle=${previewBundle}`,
  ], { encoding: 'utf8', timeout: 10_000, input: `BEGIN;
SELECT set_config('app.current_org_id', :'fixture_org', true) IS NOT NULL;
INSERT INTO content_bundle (id, org_id, model_id, asset_id, state)
SELECT :'fixture_bundle', org_id, model_id, id, 'generated' FROM asset
WHERE id = :'fixture_asset' AND org_id = :'fixture_org' AND model_id = :'fixture_model';
SELECT encode(sha256, 'hex') FROM asset
WHERE id = :'fixture_asset' AND org_id = :'fixture_org' AND model_id = :'fixture_model';
COMMIT;
` });
  assert.equal(previewFixture.status, 0, 'Disposable preview fixture must persist');
  const expectedHash = previewFixture.stdout.trim().split(/\r?\n/).at(-1);
  assert.match(expectedHash, /^[0-9a-f]{64}$/);
  const previewPath = `/api/v1/bundles/${previewBundle}/media`;
  const preview = await request(previewPath, { headers: { cookie } });
  assert.equal(preview.status, 200, 'Uploaded bytes must be available through authenticated dashboard media delivery');
  assert.equal(preview.headers.get('content-type'), 'image/png');
  const previewBytes = Buffer.from(await preview.arrayBuffer());
  assert.equal(createHash('sha256').update(previewBytes).digest('hex'), expectedHash);
  assert.equal(previewBytes.includes(Buffer.from('disposable-private-upload-marker')), false);
  assert.equal((await request(previewPath)).status, 401, 'Media preview must remain authenticated');
  console.log('upload HTTP smoke: packaged sanitizer, replay, content deduplication, source listing and tenant boundary passed');
  console.log('upload preview smoke: authenticated media bytes match stored hash and omit private trailer');
  const replayed = await request('/api/v1/models', { method: 'POST', headers: mutationHeaders, body: modelBody });
  assert.equal(replayed.status, 201, 'Profile replay preserves the original response');
  assert.equal((await replayed.json())?.data?.id, createdBody.data.id, 'Replay must not create another profile');
  const changed = await request('/api/v1/models', {
    method: 'POST', headers: mutationHeaders,
    body: JSON.stringify({ ...JSON.parse(modelBody), displayName: 'Changed intent' }),
  });
  assert.equal(changed.status, 409, 'Same key with a changed payload must conflict');
  const privateProfile = await request(`/api/v1/models/${otherModelId}`, { headers: { cookie } });
  assert.equal(privateProfile.status, 404, 'Another tenant profile must not be readable');
  const privateUpdate = await request(`/api/v1/models/${otherModelId}`, {
    method: 'PATCH', headers: { ...headers, cookie, 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ displayName: 'Unauthorized change' }),
  });
  assert.equal(privateUpdate.status, 404, 'Another tenant profile must not be writable');
  const page = await request('/api/v1/models?limit=1', { headers: { cookie } });
  assert.equal(page.status, 200);
  const pageBody = await page.json();
  assert.deepEqual(pageBody.data.map((model) => model.id), [createdBody.data.id]);
  assert.ok(pageBody.meta.next_cursor, 'Full page must supply an opaque cursor');
  const nextPage = await request(`/api/v1/models?${new URLSearchParams({ limit: '1', cursor: pageBody.meta.next_cursor })}`, { headers: { cookie } });
  assert.equal(nextPage.status, 200);
  assert.deepEqual((await nextPage.json()).data, [], 'Cursor must advance past the only tenant profile');
  const count = await request('/api/v1/models/stats/count', { headers: { cookie } });
  assert.equal(count.status, 200);
  assert.equal((await count.json())?.data?.count, 1, 'Fresh tenant has exactly one profile after replay');
  const portfolio = await request('/', { headers: { cookie } });
  assert.equal(portfolio.status, 200);
  const portfolioHtml = await portfolio.text();
  assert.match(portfolioHtml, /HTTP smoke profile/);
  assert.doesNotMatch(portfolioHtml, /Other tenant private profile/);
  const generationHeaders = { ...headers, cookie, 'Idempotency-Key': randomUUID() };
  const generationBody = JSON.stringify({ platforms: ['telegram'], enrichWithLlm: false });
  const generationPath = `/api/v1/models/${createdBody.data.id}/generate`;
  const generated = await request(generationPath, { method: 'POST', headers: generationHeaders, body: generationBody });
  assert.equal(generated.status, 201, 'Credential-free prompt generation must persist a bundle');
  const generation = (await generated.json()).data;
  assert.ok(generation.bundle?.id);
  assert.equal(generation.variants?.length, 5);
  assert.ok(generation.variants.every((variant) => variant.prompt && variant.caption));
  assert.ok(['pass', 'review', 'block'].includes(generation.tosReport?.verdict));
  assert.equal(generation.tosReport.scores[0]?.platform, 'telegram');
  const generatedReplay = await request(generationPath, { method: 'POST', headers: generationHeaders, body: generationBody });
  assert.equal(generatedReplay.status, 201);
  assert.equal((await generatedReplay.json()).data?.bundle?.id, generation.bundle.id);
  const switchStatus = await request('/api/v1/killswitch', { headers: { cookie } });
  assert.equal(switchStatus.status, 403, 'Safety control status remains owner-only');
  const persisted = await request(`/api/v1/bundles/${generation.bundle.id}`, { headers: { cookie } });
  assert.equal(persisted.status, 200);
  const persistedBody = await persisted.json();
  assert.equal(persistedBody.data?.modelId, createdBody.data.id);
  assert.equal(persistedBody.generationPaused, true,
    'A fresh tenant without an enabled safety record must report media generation paused');
  const attachedDetail = await request(`/api/v1/bundles/${previewBundle}`, { headers: { cookie } });
  assert.equal(attachedDetail.status, 200);
  assert.equal((await attachedDetail.json()).generationPaused, undefined,
    'An attached media bundle must not be described as waiting for generation');
  console.log('generation pause HTTP smoke: missing safety record fails closed; attached media does not report a generation pause');
  const queuedScan = spawnSync('psql', [
    '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href, '-v', 'ON_ERROR_STOP=1',
    '-v', `fixture_org=${orgId}`, '-v', `fixture_bundle=${generation.bundle.id}`,
  ], {
    encoding: 'utf8', timeout: 10_000,
    input: `SELECT count(*) FROM job WHERE org_id = :'fixture_org' AND kind = 'tos.scan' AND payload->>'bundleId' = :'fixture_bundle';`,
  });
  assert.equal(queuedScan.status, 0, 'ToS job verification must execute successfully');
  assert.equal(queuedScan.stdout.trim(), '1', 'Generation replay must leave exactly one durable ToS scan job');
  if (waitForToS) {
    const workerSafetyFixture = spawnSync('psql', [
      '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href, '-v', 'ON_ERROR_STOP=1',
      '-v', `fixture_org=${orgId}`,
    ], {
      encoding: 'utf8', timeout: 10_000,
      input: `INSERT INTO org_settings (org_id, publishing_enabled)
VALUES (:'fixture_org', true)
ON CONFLICT (org_id) DO UPDATE SET publishing_enabled = EXCLUDED.publishing_enabled;
SELECT publishing_enabled FROM org_settings WHERE org_id = :'fixture_org';`,
    });
    assert.equal(workerSafetyFixture.status, 0, 'Worker acceptance must explicitly enable its disposable tenant');
    assert.equal(workerSafetyFixture.stdout.trim(), 't', 'A real worker smoke must run only after explicit fixture re-enable');
    const deadline = Date.now() + 20_000;
    let completed = false;
    while (Date.now() < deadline) {
      const handoff = spawnSync('psql', [
        '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href, '-v', 'ON_ERROR_STOP=1',
        '-v', `fixture_org=${orgId}`, '-v', `fixture_bundle=${generation.bundle.id}`,
      ], {
        encoding: 'utf8', timeout: 2000,
        input: `SELECT state FROM job WHERE org_id = :'fixture_org' AND kind = 'tos.scan' AND payload->>'bundleId' = :'fixture_bundle';
SELECT count(*) FROM job WHERE org_id = :'fixture_org' AND kind = 'relay.card' AND payload->>'bundleId' = :'fixture_bundle';`,
      });
      assert.equal(handoff.status, 0, 'Worker handoff verification must execute successfully');
      const [scanState, relayCount] = handoff.stdout.trim().split(/\r?\n/);
      assert.notEqual(scanState, 'dead', 'ToS scan must not dead-letter');
      if (scanState === 'done' && relayCount === '1') { completed = true; break; }
      await delay(300);
    }
    assert.ok(completed, 'Worker must complete the ToS scan and persist one Relay handoff within 20 seconds');
    console.log('worker smoke: real ToS job completed and one Relay card job persisted (external delivery not asserted)');
    // Continue through a real operator decision after the asynchronous scan.
    // Re-read its revision rather than using the pre-worker generation response.
    const reviewed = await request(`/api/v1/bundles/${generation.bundle.id}`, { headers: { cookie } });
    assert.equal(reviewed.status, 200);
    const reviewedBundle = (await reviewed.json()).data;
    const rejectionPath = `/api/v1/bundles/${generation.bundle.id}/reject`;
    const rejectionBody = JSON.stringify({ revisionId: reviewedBundle.tosReport?.revisionId });
    const rejectionHeaders = { ...headers, cookie, 'Idempotency-Key': randomUUID() };
    const unkeyedRejection = await request(rejectionPath, {
      method: 'POST', headers: { ...headers, cookie }, body: rejectionBody,
    });
    assert.equal(unkeyedRejection.status, 400, 'Rejection must require an idempotency key');
    const rejected = await request(rejectionPath, {
      method: 'POST', headers: rejectionHeaders, body: rejectionBody,
    });
    assert.equal(rejected.status, 200, 'Operator can reject the scanned bundle');
    const rejection = await rejected.json();
    assert.equal(rejection.data?.state, 'rejected');
    const rejectionReplay = await request(rejectionPath, {
      method: 'POST', headers: rejectionHeaders, body: rejectionBody,
    });
    assert.equal(rejectionReplay.status, 200, 'Same-intent retry must recover the successful rejection');
    assert.deepEqual(await rejectionReplay.json(), rejection, 'Replay must preserve the original response');
    const repeatedRejection = await request(rejectionPath, {
      method: 'POST', headers: { ...rejectionHeaders, 'Idempotency-Key': randomUUID() }, body: rejectionBody,
    });
    assert.equal(repeatedRejection.status, 409, 'A new rejection intent cannot transition an already rejected bundle');
    const rejectionEvidence = spawnSync('psql', [
      '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href, '-v', 'ON_ERROR_STOP=1',
      '-v', `fixture_org=${orgId}`, '-v', `fixture_bundle=${generation.bundle.id}`,
    ], {
      encoding: 'utf8', timeout: 10_000,
      input: `SELECT state FROM content_bundle WHERE org_id = :'fixture_org' AND id = :'fixture_bundle';
SELECT count(*) FROM audit_log WHERE org_id = :'fixture_org' AND action = 'bundle.reject' AND target = :'fixture_bundle';
SELECT count(*) FROM post_target WHERE org_id = :'fixture_org' AND bundle_id = :'fixture_bundle';`,
    });
    assert.equal(rejectionEvidence.status, 0, 'Rejection evidence must be readable');
    assert.deepEqual(rejectionEvidence.stdout.trim().split(/\r?\n/), ['rejected', '1', '0'],
      'Rejection and retries must persist one decision audit and no publish targets');
    // The fixture has no external bindings. Bring its parked card forward so
    // the real worker must retire obsolete work rather than park it forever.
    let retiredCard = false;
    const retirementDeadline = Date.now() + 20_000;
    while (Date.now() < retirementDeadline) {
      const retirement = spawnSync('psql', [
        '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href, '-v', 'ON_ERROR_STOP=1',
        '-v', `fixture_org=${orgId}`, '-v', `fixture_bundle=${generation.bundle.id}`,
      ], {
        encoding: 'utf8', timeout: 2000,
        input: `UPDATE job SET run_after = now() WHERE org_id = :'fixture_org' AND kind = 'relay.card' AND payload->>'bundleId' = :'fixture_bundle' AND state = 'ready';
SELECT state FROM job WHERE org_id = :'fixture_org' AND kind = 'relay.card' AND payload->>'bundleId' = :'fixture_bundle';`,
      });
      assert.equal(retirement.status, 0, 'Obsolete card verification must execute successfully');
      const state = retirement.stdout.trim();
      assert.notEqual(state, 'dead', 'Obsolete card must complete rather than dead-letter');
      if (state === 'done') { retiredCard = true; break; }
      await delay(300);
    }
    assert.ok(retiredCard, 'Worker must retire the rejected bundle card within 20 seconds');
    console.log('decision smoke: generated/scanned bundle rejected, exact-response replay, new-intent conflict, one audit and no publish targets passed');
    console.log('relay lifecycle smoke: real worker retired rejected bundle card without a configured external binding');
    // Exercise successful approval separately; never rewrite the rejected
    // bundle or manufacture a passing scan. X supports text-only publishing;
    // Telegram's link-sharing connector requires media. Records are CI-only.
    const approvalGeneration = await request(generationPath, {
      method: 'POST', headers: { ...generationHeaders, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ platforms: ['x'], enrichWithLlm: false }),
    });
    assert.equal(approvalGeneration.status, 201);
    const approvalBundleId = (await approvalGeneration.json()).data.bundle.id;
    const approvalDeadline = Date.now() + 20_000;
    let approvalScanDone = false;
    while (Date.now() < approvalDeadline) {
      const scan = spawnSync('psql', [
        '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href, '-v', 'ON_ERROR_STOP=1',
        '-v', `fixture_org=${orgId}`, '-v', `fixture_bundle=${approvalBundleId}`,
      ], { encoding: 'utf8', timeout: 2000,
        input: `SELECT state FROM job WHERE org_id = :'fixture_org' AND kind = 'tos.scan' AND payload->>'bundleId' = :'fixture_bundle';` });
      assert.equal(scan.status, 0);
      assert.notEqual(scan.stdout.trim(), 'dead');
      if (scan.stdout.trim() === 'done') { approvalScanDone = true; break; }
      await delay(300);
    }
    assert.ok(approvalScanDone, 'Second real generated bundle must finish its worker scan');
    const approvalDetail = await request(`/api/v1/bundles/${approvalBundleId}`, { headers: { cookie } });
    assert.equal(approvalDetail.status, 200);
    const approvalBundle = (await approvalDetail.json()).data;
    assert.equal(approvalBundle.tosReport?.verdict, 'pass');
    const connectionId = randomUUID();
    const slot = new Date(Date.now() + 86_400_000).toISOString();
    const approvalPath = `/api/v1/bundles/${approvalBundleId}/approve`;
    const approvalBody = JSON.stringify({ platforms: ['x'], slot,
      revisionId: approvalBundle.tosReport.revisionId, connectionIds: { x: connectionId } });
    const approvalHeaders = { ...headers, cookie, 'Idempotency-Key': randomUUID() };
    assert.equal((await request(approvalPath, { method: 'POST', headers: { ...headers, cookie }, body: approvalBody })).status, 400);
    assert.equal((await request(approvalPath, { method: 'POST', headers: approvalHeaders, body: approvalBody })).status, 409,
      'A passing scan must not bypass missing consent');
    const approvalFixture = spawnSync('psql', [
      '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href, '-v', 'ON_ERROR_STOP=1',
      '-v', `fixture_org=${orgId}`, '-v', `fixture_model=${createdBody.data.id}`,
      '-v', `fixture_connection=${connectionId}`,
    ], { encoding: 'utf8', timeout: 10_000, input: `BEGIN;
INSERT INTO consent_record (org_id, model_id, platform, consent_type, granted, doc_kind, subject_ref, blob_ref, sha256)
SELECT :'fixture_org', :'fixture_model', 'x', kind, true, kind, 'synthetic-ci-subject', 'fixture://not-a-legal-document', decode(repeat('00', 32), 'hex')
FROM unnest(ARRAY['2257','model_release','id_verify','platform_consent']) AS kind;
INSERT INTO platform_connection (id, org_id, model_id, platform, display_name, enc_token, enc_nonce, dek_id)
VALUES (:'fixture_connection', :'fixture_org', :'fixture_model', 'x', 'Non-publishing CI fixture', decode('', 'hex'), decode('', 'hex'), 'invalid-ci-only');
COMMIT;` });
    assert.equal(approvalFixture.status, 0, 'Synthetic consent/account metadata fixture must persist');
    // A new intent follows remediation of the rejected precondition. Never
    // reuse a cached failure key, and never give this future job credentials.
    approvalHeaders['Idempotency-Key'] = randomUUID();
    const approved = await request(approvalPath, { method: 'POST', headers: approvalHeaders, body: approvalBody });
    assert.equal(approved.status, 200, 'Operator can approve and schedule the scanned bundle');
    const approval = await approved.json();
    assert.equal(approval.data?.state, 'approved');
    const approvalReplay = await request(approvalPath, { method: 'POST', headers: approvalHeaders, body: approvalBody });
    assert.equal(approvalReplay.status, 200);
    assert.deepEqual(await approvalReplay.json(), approval);
    assert.equal((await request(approvalPath, { method: 'POST',
      headers: { ...approvalHeaders, 'Idempotency-Key': randomUUID() }, body: approvalBody })).status, 409);
    const approvalEvidence = spawnSync('psql', [
      '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href, '-v', 'ON_ERROR_STOP=1',
      '-v', `fixture_org=${orgId}`, '-v', `fixture_bundle=${approvalBundleId}`,
      '-v', `fixture_connection=${connectionId}`, '-v', `fixture_slot=${slot}`,
    ], { encoding: 'utf8', timeout: 10_000, input: `
SELECT count(*) FROM audit_log WHERE org_id=:'fixture_org' AND action='bundle.approve' AND target=:'fixture_bundle';
SELECT count(*) FROM post_target WHERE org_id=:'fixture_org' AND bundle_id=:'fixture_bundle';
SELECT count(*) FROM job j JOIN post_target p ON j.payload->>'targetId'=p.id::text
WHERE j.org_id=:'fixture_org' AND p.org_id=:'fixture_org' AND p.bundle_id=:'fixture_bundle'
AND j.kind='publish.target' AND j.state='ready' AND p.state='pending' AND p.connection_id=:'fixture_connection'
AND j.run_after=:'fixture_slot'::timestamptz AND p.scheduled_for=:'fixture_slot'::timestamptz;
` });
    assert.equal(approvalEvidence.status, 0);
    assert.deepEqual(approvalEvidence.stdout.trim().split(/\r?\n/), ['1', '1', '1'],
      'Approval/retries must persist one audit, one target and one future publish job at the requested time');
    console.log('approval scheduling smoke: real generation/scan, consent denial, approval replay and exactly one future target/job passed; provider publication not exercised');
  }
  console.log('generation smoke: five real prompt/caption variants, text ToS report, persisted bundle, same-bundle replay and one durable scan job passed');
  const linkbioPath = `/api/v1/models/${createdBody.data.id}/linkbio`;
  const linkbioConfig = { links: [{ label: 'Disposable saved link', url: 'https://example.invalid/smoke' }] };
  const linkbioHeaders = { ...headers, cookie, 'Idempotency-Key': randomUUID() };
  const linkbioBody = JSON.stringify({ kind: 'native', config: linkbioConfig });
  const enabled = await request(linkbioPath, { method: 'POST', headers: linkbioHeaders, body: linkbioBody });
  assert.equal(enabled.status, 201, 'Native page creation must pass real middleware composition');
  const provider = (await enabled.json()).data;
  assert.deepEqual(provider.config, linkbioConfig);
  const enabledReplay = await request(linkbioPath, { method: 'POST', headers: linkbioHeaders, body: linkbioBody });
  assert.equal(enabledReplay.status, 201);
  assert.equal((await enabledReplay.json()).data.id, provider.id, 'Native page replay preserves provider identity');
  const publicPath = `/linkbio/${createdBody.data.id}`;
  const publicPage = await request(publicPath);
  assert.equal(publicPage.status, 200, 'Native page must be reachable without an operator session through the public origin');
  const publicHtml = await publicPage.text();
  assert.match(publicHtml, /Disposable saved link/);
  const clickPath = publicHtml.match(/href="(\/linkbio\/[^" ]+\/s\/[^" ]+)"/)?.[1];
  assert.ok(clickPath, 'Native page must expose a first-party tracked link');
  const click = await fetch(new URL(clickPath, base), { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  assert.equal(click.status, 302, 'Public click must return a redirect without authentication');
  const destination = new URL(click.headers.get('location'));
  assert.equal(destination.origin, 'https://example.invalid');
  assert.equal(destination.pathname, '/smoke');
  const disabled = await request(`${linkbioPath}/native`, {
    method: 'DELETE', headers: { ...headers, cookie, 'Idempotency-Key': randomUUID() },
  });
  assert.equal(disabled.status, 200);
  const disabledProvider = (await disabled.json()).data;
  assert.equal(disabledProvider.enabled, false);
  assert.deepEqual(disabledProvider.config, linkbioConfig, 'Disable must retain saved links');
  assert.equal((await request(publicPath)).status, 404, 'Disabled Native page must no longer be publicly served');
  const reenabled = await request(linkbioPath, {
    method: 'POST', headers: { ...headers, cookie, 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ kind: 'native' }),
  });
  assert.equal(reenabled.status, 201);
  const restoredProvider = (await reenabled.json()).data;
  assert.equal(restoredProvider.id, provider.id);
  assert.equal(restoredProvider.enabled, true);
  assert.deepEqual(restoredProvider.config, linkbioConfig, 'Re-enable must preserve stored configuration');
  assert.equal((await request(publicPath)).status, 200, 'Re-enabled Native page must be public again');
  const invalidLinks = await request(linkbioPath, {
    method: 'POST', headers: { ...headers, cookie, 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ kind: 'native', config: { links: [{ label: 'x'.repeat(121), url: 'https://example.invalid' }] } }),
  });
  assert.equal(invalidLinks.status, 400, 'Unrenderable links must be rejected before replacing saved content');
  const providerList = await request(linkbioPath, { headers: { cookie } });
  assert.equal(providerList.status, 200);
  const savedProviders = (await providerList.json()).data.providers;
  assert.equal(savedProviders.length, 1, 'Lifecycle must not duplicate providers');
  // The list view adds read-only tracked-link fields (slug, path); compare the saved content itself.
  const listedLinks = savedProviders[0].config.links;
  assert.deepEqual({ ...savedProviders[0].config, links: listedLinks.map(({ label, url }) => ({ label, url })) }, linkbioConfig,
    'Rejected link edits must leave saved content unchanged');
  assert.ok(listedLinks.every((link) => typeof link.path === 'string' && link.path.startsWith(`/linkbio/${createdBody.data.id}/s/`)),
    'Listed Native links must expose their tracked short-link path');
  console.log('linkbio smoke: native creation, same-ID replay, anonymous page and tracked redirect, disable/404 and re-enable with preserved links passed (no external URL fetched)');
  const networkPath = `/api/v1/models/${createdBody.data.id}/network`;
  const operatorNetworkRead = await request(networkPath, { headers: { cookie } });
  assert.equal(operatorNetworkRead.status, 403, 'Network metadata is owner-only, including reads');
  const operatorNetworkWrite = await request(networkPath, {
    method: 'PUT', headers: { ...headers, cookie, 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ egressMode: 'direct', proxyAddr: null, expectedEgressIp: null }),
  });
  assert.equal(operatorNetworkWrite.status, 403, 'An ordinary operator cannot change network settings');
  // Test-only owner assignment, scoped to this freshly created fixture identity.
  // The production signup and authorization paths remain unchanged.
  const ownerFixture = spawnSync('psql', [
    '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href, '-v', 'ON_ERROR_STOP=1',
    '-v', `fixture_org=${orgId}`, '-v', `fixture_email=${email}`,
  ], {
    encoding: 'utf8', timeout: 10_000,
    input: `WITH assigned AS (
UPDATE auth_user SET role = 'owner' WHERE email = :'fixture_email' AND org_id = :'fixture_org' AND role = 'operator' RETURNING id
) SELECT count(*) FROM assigned;`,
  });
  assert.equal(ownerFixture.status, 0, 'Disposable owner fixture must apply successfully');
  assert.equal(ownerFixture.stdout.trim(), '1', 'Only the synthetic operator may be assigned ownership');
  const missingSafetyFixture = spawnSync('psql', [
    '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href, '-v', 'ON_ERROR_STOP=1',
    '-v', `fixture_org=${orgId}`,
  ], {
    encoding: 'utf8', timeout: 10_000,
    input: `DELETE FROM org_settings WHERE org_id = :'fixture_org';
SELECT count(*) FROM org_settings WHERE org_id = :'fixture_org';`,
  });
  assert.equal(missingSafetyFixture.status, 0, 'Disposable missing-settings fixture must reset successfully');
  assert.equal(missingSafetyFixture.stdout.trim().split(/\r?\n/).at(-1), '0',
    'Safety status acceptance must start from a missing org settings row');
  const ownerSession = await request('/api/auth/get-session', { headers: { cookie } });
  assert.equal(ownerSession.status, 200);
  const ownerSessionBody = await ownerSession.json();
  assert.equal(ownerSessionBody.user.role, 'owner', 'Session must reflect the server-assigned role');
  assert.ok(typeof ownerSessionBody.user.id === 'string' && ownerSessionBody.user.id.length > 0,
    'Owner identity must be available for audited safety actions');
  const ownerSwitchStatus = await request('/api/v1/killswitch', { headers: { cookie } });
  assert.equal(ownerSwitchStatus.status, 200);
  assert.deepEqual((await ownerSwitchStatus.json()).data, {
    enabled: true, reason: '', startedAt: null, updatedAt: null,
  }, 'Reading missing safety settings must report emergency pause without initializing them');
  const settingsRows = spawnSync('psql', [
    '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href, '-v', 'ON_ERROR_STOP=1',
    '-v', `fixture_org=${orgId}`,
  ], {
    encoding: 'utf8', timeout: 10_000,
    input: `SELECT count(*) FROM org_settings WHERE org_id = :'fixture_org';`,
  });
  assert.equal(settingsRows.status, 0, 'Read-only safety status verification must execute');
  assert.equal(settingsRows.stdout.trim(), '0', 'GET safety status must not create settings');
  console.log('safety status HTTP smoke: operator denied; owner read fails closed and creates no settings');

  // Prepare two real model-scoped MCP capabilities and two durable publish
  // queue entries in this one disposable organization. Keep the jobs delayed
  // until after the audited org pause so the live CI worker cannot race setup.
  const safetyReady = spawnSync('psql', [
    '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href, '-v', 'ON_ERROR_STOP=1',
    '-v', `fixture_org=${orgId}`,
  ], { encoding: 'utf8', timeout: 10_000, input: `
INSERT INTO org_settings (org_id, publishing_enabled)
VALUES (:'fixture_org', true)
ON CONFLICT (org_id) DO UPDATE SET
  publishing_enabled = true,
  kill_switch_reason = NULL,
  kill_switch_actor = NULL,
  kill_switch_at = NULL;
SELECT publishing_enabled FROM org_settings WHERE org_id = :'fixture_org';
` });
  assert.equal(safetyReady.status, 0, 'Disposable safety settings must be explicitly enabled for the baseline');
  assert.equal(safetyReady.stdout.trim(), 't', 'Baseline org safety state must be enabled before the pause action');

  const secondModelId = randomUUID();
  const secondModelHandle = `l5-${randomBytes(8).toString('hex')}`;
  const secondModelFixture = spawnSync('psql', [
    '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href, '-v', 'ON_ERROR_STOP=1',
    '-v', `fixture_org=${orgId}`, '-v', `fixture_model=${secondModelId}`, '-v', `fixture_handle=${secondModelHandle}`,
  ], { encoding: 'utf8', timeout: 10_000, input: `
INSERT INTO model_profile (id, org_id, display_name, handle)
VALUES (:'fixture_model', :'fixture_org', 'L5 second synthetic model', :'fixture_handle');
SELECT count(*) FROM model_profile WHERE id = :'fixture_model' AND org_id = :'fixture_org';
` });
  assert.equal(secondModelFixture.status, 0, 'Second synthetic model must be created in the disposable organization');
  assert.equal(secondModelFixture.stdout.trim(), '1', 'Cross-model pause fixture must contain its second model');

  const createAgentCapability = async (modelId, agentRef) => {
    const permissionResponse = await request(`/api/v1/models/${modelId}/agent-permissions`, {
      method: 'POST',
      headers: { ...headers, cookie, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ agentRef, tier: 'manager', canPublish: true }),
    });
    const permissionResult = await permissionResponse.clone().json().catch(() => null);
    const permissionDetail = typeof permissionResult?.detail === 'string'
      ? permissionResult.detail.replace(/[\r\n\t]/g, ' ').slice(0, 200)
      : 'no safe API detail';
    assert.equal(permissionResponse.status, 201,
      `Owner must be able to create a model-scoped synthetic agent grant (HTTP ${permissionResponse.status}: ${permissionDetail})`);
    const permission = (await permissionResponse.json()).data;
    assert.equal(permission.modelId, modelId);
    const tokenResponse = await request(`/api/v1/models/${modelId}/agent-permissions/${permission.id}/tokens`, {
      method: 'POST',
      headers: { ...headers, cookie, 'Idempotency-Key': randomUUID() },
      body: '{}',
    });
    assert.equal(tokenResponse.status, 201, 'Owner must be able to issue a short-lived synthetic agent token');
    const grant = (await tokenResponse.json()).data;
    assert.ok(grant.token && grant.tokenId, 'Token issuance must return its one-time token and durable token ID');
    return { modelId, permissionId: permission.id, tokenId: grant.tokenId, token: grant.token };
  };
  const modelIds = [createdBody.data.id, secondModelId];
  const capabilities = await Promise.all(modelIds.map((modelId, index) =>
    createAgentCapability(modelId, `l5-killswitch-${index}-${randomBytes(4).toString('hex')}`)));
  const callAgentToolsList = (capability) => request('/api/mcp', {
    method: 'POST',
    headers: {
      ...headers,
      authorization: `Bearer ${capability.token}`,
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/list', params: {} }),
  });
  for (const capability of capabilities) {
    const activeAgent = await callAgentToolsList(capability);
    assert.equal(activeAgent.status, 200, 'Each synthetic model agent must authenticate before the org pause');
  }

  const publishJobIds = [randomUUID(), randomUUID()];
  const queuedPublishFixture = spawnSync('psql', [
    '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href, '-v', 'ON_ERROR_STOP=1',
    '-v', `fixture_org=${orgId}`, '-v', `fixture_job_a=${publishJobIds[0]}`, '-v', `fixture_job_b=${publishJobIds[1]}`,
    '-v', `fixture_model_a=${modelIds[0]}`, '-v', `fixture_model_b=${modelIds[1]}`,
    '-v', `fixture_target_a=${randomUUID()}`, '-v', `fixture_target_b=${randomUUID()}`,
  ], { encoding: 'utf8', timeout: 10_000, input: `
INSERT INTO job (id, org_id, queue, kind, state, payload, attempts, max_attempts, run_after)
VALUES
  (:'fixture_job_a', :'fixture_org', 'publish', 'publish.target', 'ready',
   jsonb_build_object('modelId', :'fixture_model_a', 'targetId', :'fixture_target_a'), 0, 3, now() + interval '1 hour'),
  (:'fixture_job_b', :'fixture_org', 'publish', 'publish.target', 'ready',
   jsonb_build_object('modelId', :'fixture_model_b', 'targetId', :'fixture_target_b'), 0, 3, now() + interval '1 hour');
SELECT count(DISTINCT payload->>'modelId') FROM job
WHERE id IN (:'fixture_job_a'::uuid, :'fixture_job_b'::uuid) AND org_id = :'fixture_org';
` });
  assert.equal(queuedPublishFixture.status, 0, 'Synthetic publishing work must be delayed in the disposable database');
  assert.equal(queuedPublishFixture.stdout.trim(), '2', 'Queued publishing work must cover both models');

  const pauseStarted = Date.now();
  const paused = await request('/api/v1/killswitch/enable', {
    method: 'POST',
    headers: { ...headers, cookie, 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ reason: 'L5 cross-model kill-switch acceptance' }),
  });
  assert.equal(paused.status, 200, 'owner pause must persist and receive egress-plane readback');
  assert.ok(Date.now() - pauseStarted < 5_000, 'organization egress pause must complete within five seconds');
  assert.equal((await (await request('/api/v1/killswitch', { headers: { cookie } })).json()).data.enabled, true);

  const enableAudit = spawnSync('psql', [
    '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href, '-v', 'ON_ERROR_STOP=1',
    '-v', `fixture_org=${orgId}`, '-v', `fixture_user=${ownerSessionBody.user.id}`,
  ], { encoding: 'utf8', timeout: 10_000, input: `
SELECT
  (SELECT count(*) FROM kill_switch WHERE org_id = :'fixture_org' AND scope = 'org'
   AND action = 'enable' AND reason = 'L5 cross-model kill-switch acceptance' AND actor_ref = :'fixture_user') || '|' ||
  (SELECT count(*) FROM audit_log WHERE org_id = :'fixture_org' AND action = 'killswitch.enable'
   AND target = :'fixture_org' AND detail->>'reason' = 'L5 cross-model kill-switch acceptance' AND actor_ref = :'fixture_user');
` });
  assert.equal(enableAudit.status, 0, 'Pause action audit records must be readable from the disposable database');
  assert.equal(enableAudit.stdout.trim(), '1|1', 'One operator action must create one durable kill-switch event and one chained audit event');

  for (const capability of capabilities) {
    const pausedAgent = await callAgentToolsList(capability);
    assert.equal(pausedAgent.status, 423, 'The same org pause must deny each model-scoped agent surface');
  }

  const publishJobsDue = spawnSync('psql', [
    '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href, '-v', 'ON_ERROR_STOP=1',
    '-v', `fixture_job_a=${publishJobIds[0]}`, '-v', `fixture_job_b=${publishJobIds[1]}`,
  ], { encoding: 'utf8', timeout: 10_000, input: `
UPDATE job SET run_after = now() WHERE id IN (:'fixture_job_a'::uuid, :'fixture_job_b'::uuid);
SELECT count(*) FROM job WHERE id IN (:'fixture_job_a'::uuid, :'fixture_job_b'::uuid) AND run_after <= now();
` });
  assert.equal(publishJobsDue.status, 0, 'Synthetic publishing jobs must become due only after the org pause');
  assert.equal(publishJobsDue.stdout.trim(), '2', 'Both model publishing jobs must be released to the live worker while paused');

  const workerPauseDeadline = pauseStarted + 5_000;
  let parkedPublishJobs = '0';
  while (Date.now() < workerPauseDeadline) {
    const workerReadback = spawnSync('psql', [
      '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href, '-v', 'ON_ERROR_STOP=1',
      '-v', `fixture_job_a=${publishJobIds[0]}`, '-v', `fixture_job_b=${publishJobIds[1]}`,
    ], { encoding: 'utf8', timeout: 2_000, input: `
SELECT count(*) FROM job WHERE id IN (:'fixture_job_a'::uuid, :'fixture_job_b'::uuid)
  AND state = 'ready' AND attempts = 0 AND locked_by IS NULL
  AND last_error ILIKE '%organization kill switch enabled%';
` });
    assert.equal(workerReadback.status, 0, 'Worker pause readback must use the disposable database');
    parkedPublishJobs = workerReadback.stdout.trim();
    if (parkedPublishJobs === '2') break;
    await delay(100);
  }
  assert.equal(parkedPublishJobs, '2', 'Live worker must park both models’ publish jobs without consuming attempts within five seconds');
  const parkedModels = spawnSync('psql', [
    '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href, '-v', 'ON_ERROR_STOP=1',
    '-v', `fixture_job_a=${publishJobIds[0]}`, '-v', `fixture_job_b=${publishJobIds[1]}`,
  ], { encoding: 'utf8', timeout: 10_000, input: `
SELECT count(DISTINCT payload->>'modelId') || '|' ||
       count(*) FILTER (WHERE state = 'ready' AND attempts = 0 AND locked_by IS NULL
                        AND last_error ILIKE '%organization kill switch enabled%')
FROM job WHERE id IN (:'fixture_job_a'::uuid, :'fixture_job_b'::uuid);
` });
  assert.equal(parkedModels.status, 0, 'Cross-model worker state must be readable');
  assert.equal(parkedModels.stdout.trim(), '2|2', 'Both distinct models must remain parked before any publishing executor runs');

  const deferCleanupJobs = spawnSync('psql', [
    '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href, '-v', 'ON_ERROR_STOP=1',
    '-v', `fixture_job_a=${publishJobIds[0]}`, '-v', `fixture_job_b=${publishJobIds[1]}`,
  ], { encoding: 'utf8', timeout: 10_000, input: `
UPDATE job SET run_after = now() + interval '1 hour'
WHERE id IN (:'fixture_job_a'::uuid, :'fixture_job_b'::uuid);
SELECT count(*) FROM job WHERE id IN (:'fixture_job_a'::uuid, :'fixture_job_b'::uuid)
  AND run_after > now();
` });
  assert.equal(deferCleanupJobs.status, 0, 'Parked fixture jobs must be held before separate re-enable');
  assert.equal(deferCleanupJobs.stdout.trim(), '2', 'No synthetic publish job may race the re-enable action');

  const resumed = await request('/api/v1/killswitch/disable', {
    method: 'POST',
    headers: { ...headers, cookie, 'Idempotency-Key': randomUUID() },
    body: '{}',
  });
  assert.equal(resumed.status, 200, 'owner resume must receive egress-plane readback');
  assert.equal((await (await request('/api/v1/killswitch', { headers: { cookie } })).json()).data.enabled, false);
  for (const capability of capabilities) {
    const resumedAgent = await callAgentToolsList(capability);
    assert.equal(resumedAgent.status, 200, 'Model-scoped agent access must return only after the separate re-enable action');
  }

  const fullAudit = spawnSync('psql', [
    '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href, '-v', 'ON_ERROR_STOP=1',
    '-v', `fixture_org=${orgId}`, '-v', `fixture_user=${ownerSessionBody.user.id}`,
  ], { encoding: 'utf8', timeout: 10_000, input: `
SELECT
  (SELECT count(*) FROM kill_switch WHERE org_id = :'fixture_org' AND scope = 'org'
   AND action = 'enable' AND reason = 'L5 cross-model kill-switch acceptance' AND actor_ref = :'fixture_user') || '|' ||
  (SELECT count(*) FROM kill_switch WHERE org_id = :'fixture_org' AND scope = 'org'
   AND action = 'disable' AND actor_ref = :'fixture_user') || '|' ||
  (SELECT count(*) FROM audit_log WHERE org_id = :'fixture_org' AND action = 'killswitch.enable'
   AND target = :'fixture_org' AND detail->>'reason' = 'L5 cross-model kill-switch acceptance' AND actor_ref = :'fixture_user') || '|' ||
  (SELECT count(*) FROM audit_log WHERE org_id = :'fixture_org' AND action = 'killswitch.disable'
   AND target = :'fixture_org' AND actor_ref = :'fixture_user');
` });
  assert.equal(fullAudit.status, 0, 'Enable and re-enable audit rows must remain readable');
  assert.equal(fullAudit.stdout.trim(), '1|1|1|1', 'Enable and separate re-enable must each persist one operator event and one audit-chain entry');

  for (const capability of capabilities) {
    const revoked = await request(
      `/api/v1/models/${capability.modelId}/agent-permissions/${capability.permissionId}/tokens/${capability.tokenId}/revoke`,
      { method: 'POST', headers: { ...headers, cookie, 'Idempotency-Key': randomUUID() }, body: '{}' },
    );
    assert.equal(revoked.status, 200, 'Synthetic agent token must be revoked during cleanup');
    const removed = await request(`/api/v1/models/${capability.modelId}/agent-permissions/${capability.permissionId}`, {
      method: 'DELETE', headers: { ...headers, cookie, 'Idempotency-Key': randomUUID() },
    });
    assert.equal(removed.status, 200, 'Synthetic agent permission must be removed during cleanup');
  }
  const cleanup = spawnSync('psql', [
    '-X', '-q', '-t', '-A', '-d', fixtureDatabase.href, '-v', 'ON_ERROR_STOP=1',
    '-v', `fixture_job_a=${publishJobIds[0]}`, '-v', `fixture_job_b=${publishJobIds[1]}`,
    '-v', `fixture_model=${secondModelId}`,
    '-v', `fixture_token_a=${capabilities[0].tokenId}`, '-v', `fixture_token_b=${capabilities[1].tokenId}`,
    '-v', `fixture_org=${orgId}`,
  ], { encoding: 'utf8', timeout: 10_000, input: `
DELETE FROM job WHERE id IN (:'fixture_job_a'::uuid, :'fixture_job_b'::uuid);
DELETE FROM mcp_token_revocation WHERE token_id IN (:'fixture_token_a', :'fixture_token_b');
DELETE FROM model_profile WHERE id = :'fixture_model' AND org_id = :'fixture_org';
SELECT (SELECT count(*) FROM job WHERE id IN (:'fixture_job_a'::uuid, :'fixture_job_b'::uuid)) || '|' ||
       (SELECT count(*) FROM model_profile WHERE id = :'fixture_model' AND org_id = :'fixture_org');
` });
  assert.equal(cleanup.status, 0, 'Synthetic cross-model kill-switch resources must be removed from the disposable database');
  assert.equal(cleanup.stdout.trim(), '0|0', 'Synthetic jobs and second model must be absent after cleanup');
  console.log('LBI-11 acceptance result: 1 passed, 0 failed, 0 skipped');
  console.log(`LBI-11 smoke: one audited owner action paused two model agents and two publish jobs within five seconds; separate audited re-enable restored agents; cleanup verified (${Date.now() - pauseStarted}ms)`);

  const apiContainer = process.env.AXIOM_CI_API_CONTAINER;
  if (apiContainer) {
    const rehearsalId = process.env.AXIOM_CI_REHEARSAL_ID ?? '';
    assert.equal(process.env.CI, 'true', 'API restart probe is CI-only');
    assert.match(rehearsalId, /^\d+-\d+-[a-f0-9]{12}$/, 'API restart probe requires its unique rehearsal id');
    assert.equal(apiContainer, `axiom-ci-${rehearsalId}-hono`, 'API restart target must be this rehearsal container');
    const ownedLabel = spawnSync('docker', [
      'inspect', '--format={{ index .Config.Labels "com.fanthynks.rehearsal-id" }}', apiContainer,
    ], { encoding: 'utf8', timeout: 5_000 });
    assert.equal(ownedLabel.status, 0, 'API restart target must exist');
    assert.equal(ownedLabel.stdout.trim(), rehearsalId, 'API restart target must carry this rehearsal label');
    const restart = spawnSync('docker', ['restart', '--timeout', '10', apiContainer], {
      encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(restart.status, 0, 'owned API container must restart successfully');

    let persistedSession = false;
    for (let attempt = 0; attempt < 45; attempt++) {
      try {
        const ready = await request('/api/v1/ready');
        if (ready.ok) {
          const restored = await request('/api/auth/get-session', { headers: { cookie } });
          if (restored.ok) {
            const body = await restored.json();
            if (body?.user?.email === email) {
              persistedSession = true;
              break;
            }
          }
        }
      } catch {
        // The dashboard rewrite can briefly return a transport error as the
        // API container restarts; retry only this read-only readiness/session probe.
      }
      await delay(1_000);
    }
    assert.ok(persistedSession, 'signed-in session must survive API restart through the dashboard rewrite');
    console.log('deployment restart smoke: API readiness and database-backed session survived restart');
  }

  const crashCorrelationId = randomUUID();
  const crashFingerprint = `deployment-smoke-${randomUUID()}`;
  const crashMessage = 'Synthetic deployment fault control';
  const reportCrash = (eventId) => request('/api/v1/crash-reports', {
    method: 'POST',
    headers: { ...headers, cookie, 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      eventId,
      service: 'deployment-smoke',
      release: process.env.GITHUB_SHA ?? 'local-smoke',
      environment: 'ci',
      message: crashMessage,
      stacktrace: [{ frame: 0, function: 'deploymentFaultControl' }],
      correlationId: crashCorrelationId,
      severity: 'sev-2',
      fingerprint: crashFingerprint,
    }),
  });
  const firstCrashResponse = await reportCrash(randomUUID());
  const firstCrashBody = await firstCrashResponse.text();
  assert.equal(firstCrashResponse.status, 200, `synthetic crash report must persist: ${firstCrashBody}`);
  const firstCrash = JSON.parse(firstCrashBody);
  assert.equal(firstCrash.isNew, true, 'first fingerprint occurrence must create an issue');
  const repeatedCrashResponse = await reportCrash(randomUUID());
  assert.equal(repeatedCrashResponse.status, 200, 'repeated synthetic crash must persist');
  const repeatedCrash = await repeatedCrashResponse.json();
  assert.equal(repeatedCrash.isNew, false, 'repeated fingerprint must deduplicate');
  assert.equal(repeatedCrash.data.id, firstCrash.data.id, 'deduplicated report must retain its issue id');
  assert.equal(repeatedCrash.data.count, 2, 'deduplicated report must increment its occurrence count');
  assert.equal(repeatedCrash.data.correlationId, crashCorrelationId, 'correlation id must survive the upsert');
  const crashListResponse = await request('/api/v1/crash-reports?status=open', { headers: { cookie } });
  assert.equal(crashListResponse.status, 200);
  const crashList = await crashListResponse.json();
  assert.ok(crashList.data.some((row) => row.id === firstCrash.data.id && row.correlationId === crashCorrelationId));
  const incidentsPage = await request('/incidents', { headers: { cookie } });
  assert.equal(incidentsPage.status, 200, 'owner must be able to open crash reports in the dashboard');
  const incidentsHtml = await incidentsPage.text();
  assert.ok(incidentsHtml.includes('deployment-smoke') && incidentsHtml.includes(crashMessage),
    'deduplicated crash report must be visible on the incidents page');
  console.log('crash-report smoke: correlation, fingerprint deduplication, count readback and incident dashboard visibility passed (synthetic report)');

  for (const values of [
    { proxyAddr: '127.0.0.1:1080', expectedEgressIp: '203.0.113.7' },
    { proxyAddr: null, expectedEgressIp: null },
  ]) {
    const savedNetwork = await request(networkPath, {
      method: 'PUT', headers: { ...headers, cookie, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ egressMode: 'direct', ...values }),
    });
    assert.equal(savedNetwork.status, 200, 'Network metadata save must succeed');
    const networkRead = await request(networkPath, { headers: { cookie } });
    assert.equal(networkRead.status, 200);
    const network = (await networkRead.json()).data;
    assert.equal(network.proxyAddr, values.proxyAddr, 'Proxy metadata must reflect the saved value, including clearing');
    assert.equal(network.expectedEgressIp, values.expectedEgressIp, 'Expected IP metadata must reflect the saved value, including clearing');
  }
  console.log('network smoke: operator read/write denial, fixture-owner metadata save and clear passed (no plane binding or egress claim)');
  console.log('tenant smoke: assigned operator, required idempotency, single profile after replay, changed-payload conflict, cross-tenant read/write denial, cursor/count isolation and dashboard rendering passed');
}
const signout = await request('/api/auth/sign-out', {
  method: 'POST',
  headers: { ...headers, cookie },
  body: '{}',
});
assert.equal(signout.status, 200, 'signout status');
const revoked = await request('/api/auth/get-session', { headers: { cookie } });
assert.equal(revoked.status, 200, 'revoked session lookup status');
assert.equal(await revoked.json(), null, 'old session must no longer authenticate');
console.log(
  'auth smoke: login, anonymous/unassigned denial, access-pending dashboard, signup privilege rejection, signin, HttpOnly session restore and revocation passed',
);
