// Executed only inside the owned disposable runner. No external target option.
import { chromium, request, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import https from 'node:https';
import http from 'node:http';

const origin = 'https://127.0.0.1:3443';
const mode = process.argv[2];
if (!['default', 'configured', 'negative-brand', 'negative-cookie'].includes(mode)) throw new Error('Unknown fixture mode');
if (process.env.CI !== 'true' || process.env.AXIOM_BROWSER_FIXTURE !== 'owned-internal') throw new Error('Fixture guard missing');
const database = new URL(process.env.MIGRATOR_DATABASE_URL);
if (database.hostname !== '127.0.0.1' || database.pathname !== '/axiom_test') throw new Error('Disposable database required');
const configured = mode !== 'default';
const name = configured ? 'Fixture Studio <&> {email}' : 'FanThynks';
const tagline = configured ? 'Private fixture creator workspace' : null;
const dir = mkdtempSync(join(tmpdir(), 'axiom-browser-'));
const cert = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
  '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
if (cert.status !== 0) throw new Error('Fixture certificate creation failed');
const proxy = https.createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (incoming, outgoing) => {
  const upstream = http.request({ hostname: '127.0.0.1', port: 3000, path: incoming.url, method: incoming.method,
    headers: { ...incoming.headers, 'x-forwarded-proto': 'https', 'x-forwarded-host': '127.0.0.1:3443' } }, response => {
    const headers = { ...response.headers };
    // Negative control belongs to this test-only proxy, never to application code.
    if (mode === 'negative-cookie') delete headers['set-cookie'];
    outgoing.writeHead(response.statusCode, headers);
    response.pipe(outgoing);
  });
  upstream.on('error', () => { outgoing.writeHead(502); outgoing.end(); });
  incoming.pipe(upstream);
});
await new Promise(resolve => proxy.listen(3443, '127.0.0.1', resolve));
const results = [];
const probes = [];
let currentCheck = 'browser launch';
let faultObserved = false;
const check = async (label, work) => {
  currentCheck = label;
  await work();
  results.push(label);
};
const browser = await chromium.launch({ headless: true });
let context;
try {
  const password = randomBytes(24).toString('base64url');
  const email = `browser-${randomUUID()}@example.invalid`;
  const pendingEmail = `pending-${randomUUID()}@example.invalid`;
  const otherOrg = randomUUID();
  const org = randomUUID();
  const ownModel = randomUUID();
  const otherModel = randomUUID();
  const bootstrap = await request.newContext({ baseURL: origin, ignoreHTTPSErrors: true, extraHTTPHeaders: { origin } });
  try {
    for (const identity of [email, pendingEmail]) {
      await check('real public signup ' + (identity === email ? 'operator' : 'unassigned'), async () => {
        const response = await bootstrap.post('/api/auth/sign-up/email', { data: { email: identity, password, name: 'Browser fixture operator' } });
        expect(response.status()).toBe(200);
      });
    }
  } finally { await bootstrap.dispose(); }
  await check('two-tenant fixture provisioned', async () => {
    const seeded = spawnSync('psql', ['-X', '-q', '-t', '-A', '-d', database.href, '-v', 'ON_ERROR_STOP=1',
      '-v', `email=${email}`, '-v', `org=${org}`, '-v', `other_org=${otherOrg}`,
      '-v', `model=${ownModel}`, '-v', `other_model=${otherModel}`], { encoding: 'utf8', timeout: 10000, input: `BEGIN;
INSERT INTO org (id, name, slug) VALUES (:'org', 'Browser fixture', :'org'), (:'other_org', 'Other browser fixture', :'other_org');
INSERT INTO model_profile (id, org_id, display_name, handle) VALUES
(:'model', :'org', 'Visible fixture talent', :'model'), (:'other_model', :'other_org', 'Hidden other tenant talent', :'other_model');
UPDATE auth_user SET org_id = :'org' WHERE email = :'email' AND org_id IS NULL AND role = 'operator';
SELECT count(*) FROM auth_user WHERE email = :'email' AND org_id = :'org' AND role = 'operator';
COMMIT;
` });
    expect(seeded.status).toBe(0);
    expect(seeded.stdout.trim()).toBe('1');
  });
  context = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const deliveredBodies = [];
  let scriptCount = 0;
  page.on('response', response => {
    const kind = response.request().resourceType();
    if (kind === 'script') scriptCount++;
    // Read while each response is available, before a later navigation can
    // evict it from Chromium's resource buffer. Retain only a boolean.
    if (['document', 'script'].includes(kind)) deliveredBodies.push(response.body()
      .then(body => !body.includes(Buffer.from(process.env.BROWSER_SECRET_SENTINEL)))
      .catch(() => false));
  });
  const status = async path => {
    const value = await page.evaluate(async path => (await fetch(path, { cache: 'no-store' })).status, path);
    probes.push({ path: path.replace(/[a-f0-9-]{36}/g, '<fixture-id>'), status: value });
    return value;
  };
  const signIn = async (identity, suppliedPassword) => {
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(identity);
    await page.getByLabel('Password', { exact: true }).fill(suppliedPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  };
  await page.goto('/login');
  await check('public brand projection', async () => {
    const response = await context.request.get('/api/v1/brand');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(await response.json()).toEqual({ data: { name, tagline } });
  });
  await check('rendered brand and metadata', async () => {
    const expected = mode === 'negative-brand' ? 'Deliberately wrong expected brand' : name;
    if (mode === 'negative-brand') {
      await expect(page).toHaveTitle(`Sign in · ${name}`);
      faultObserved = true;
    }
    await expect(page).toHaveTitle(`Sign in · ${expected}`);
    await expect(page.locator('.brand-wordmark').first()).toHaveText(expected);
    if (tagline) await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', tagline);
    expect(await page.locator('body').innerText()).not.toMatch(/\bAXIOM\b/);
  });
  await check('anonymous API denied', async () => { expect(await status('/api/v1/models')).toBe(401); });
  await check('bad password stays signed out', async () => {
    await signIn(email, 'deliberately-wrong-password');
    await expect(page.getByRole('alert')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/login');
    expect(await status('/api/v1/models')).toBe(401);
  });
  await check('unassigned identity pending', async () => {
    await signIn(pendingEmail, password);
    if (mode === 'negative-cookie') {
      await expect(page.getByRole('alert')).toContainText('browser session could not be confirmed');
      expect((await context.cookies(origin)).some(cookie => cookie.name.includes('session_token'))).toBe(false);
      faultObserved = true;
    }
    await expect(page.getByRole('heading', { name: 'Workspace access pending' })).toBeVisible();
    expect(await status('/api/v1/models')).toBe(401);
  });
  await page.getByRole('button', { name: 'Sign out', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await check('browser session retained', async () => {
    await signIn(email, password);
    await expect(page.getByRole('heading', { name: 'Visible fixture talent', exact: true })).toBeVisible();
    const cookies = await context.cookies(origin);
    expect(cookies.some(cookie => cookie.name.includes('session_token') && cookie.secure && cookie.httpOnly)).toBe(true);
  });
  await check('workspace restored after reload', async () => {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Visible fixture talent', exact: true })).toBeVisible();
    await expect(page.getByText('Hidden other tenant talent', { exact: true })).toHaveCount(0);
  });
  await check('tenant list contains exactly its own record', async () => {
    const models = await page.evaluate(async () => (await (await fetch('/api/v1/models')).json()).data);
    expect(models.map(model => model.id)).toEqual([ownModel]);
  });
  await check('cross-tenant read denied', async () => {
    expect(await status(`/api/v1/models/${otherModel}`)).toBe(404);
  });
  await check('owner-only control denied', async () => {
    expect(await status('/api/v1/killswitch')).toBe(403);
  });
  await check('configured navigation and literal text', async () => {
    await expect(page.locator('.sidebar .brand-wordmark')).toHaveText(name);
    if (tagline) await expect(page.locator('.sidebar .brand-copy small')).toHaveText(tagline);
    expect(await page.locator('body').innerText()).not.toContain('Hidden other tenant talent');
  });
  await check('logout revokes browser access', async () => {
    await page.getByRole('button', { name: 'Sign out', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    expect(await status('/api/v1/models')).toBe(401);
    await page.reload();
    expect(await status('/api/v1/models')).toBe(401);
  });
  await check('no server secret in delivered HTML or scripts', async () => {
    const sentinel = process.env.BROWSER_SECRET_SENTINEL;
    expect(typeof sentinel === 'string' && sentinel.length >= 32).toBe(true);
    expect(scriptCount).toBeGreaterThan(0);
    expect((await Promise.all(deliveredBodies)).every(Boolean)).toBe(true);
  });
  if (mode.startsWith('negative-')) throw new Error('Negative control unexpectedly passed');
  console.log(JSON.stringify({ mode, passed: results.length, failed: 0, skipped: 0, checks: results }));
} catch {
  // Never dump Playwright call logs, credential form values, cookies or HTML.
  const expected = mode === 'negative-brand' ? 'rendered brand and metadata'
    : mode === 'negative-cookie' ? 'unassigned identity pending' : null;
  if (expected && faultObserved && currentCheck === expected) {
    console.log(JSON.stringify({ mode, passed: results.length, failed: 1, skipped: 0, expectedFailure: currentCheck }));
  } else {
    console.error(JSON.stringify({ mode, passed: results.length, failed: 1, skipped: 0, failure: currentCheck, probes }));
    process.exitCode = 1;
  }
} finally {
  await context?.close();
  await browser.close();
  proxy.closeAllConnections();
  await new Promise(resolve => proxy.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}
