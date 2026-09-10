// HTTP integration probe for disposable local/CI databases only. Creates one
// synthetic user; database teardown removes it. This does not claim browser
// cookie/TLS coverage: CI supplies the configured HTTPS Origin over loopback.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

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
  'auth smoke: login, anonymous/unassigned denial, signup privilege rejection, signin, HttpOnly session restore and revocation passed',
);
