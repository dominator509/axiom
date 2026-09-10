// HTTP integration probe for disposable local/CI databases only. Creates one
// synthetic user; database teardown removes it. This does not claim browser
// cookie/TLS coverage: CI supplies the configured HTTPS Origin over loopback.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

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
let fixtureDatabase;
if (tenantFixture) {
  assert.equal(process.env.CI, 'true', 'Tenant fixture requires explicit CI mode');
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
