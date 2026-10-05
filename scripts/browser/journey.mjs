// Executed only inside the owned disposable runner. No external target option.
import { chromium, request, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const origin = 'https://127.0.0.1:3443';
const mode = process.argv[2];
if (!['default', 'configured', 'negative-brand', 'negative-cookie'].includes(mode)) throw new Error('Unknown fixture mode');
if (process.env.CI !== 'true' || process.env.AXIOM_BROWSER_FIXTURE !== 'owned-internal') throw new Error('Fixture guard missing');
const safePath = value => new URL(value, origin).pathname.replace(/[a-f0-9-]{36}/g, '<fixture-id>');
const database = new URL(process.env.MIGRATOR_DATABASE_URL);
if (database.hostname !== '127.0.0.1' || database.pathname !== '/axiom_test') throw new Error('Disposable database required');
const configured = mode !== 'default';
const name = configured ? 'Fixture Studio <&> {email} %s $& $$' : 'FanThynks';
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
const redirects = [];
let currentCheck = 'browser launch';
let faultObserved = false;
const diagnosticRedactions = new Set([process.env.BROWSER_SECRET_SENTINEL].filter(Boolean));
const safeDiagnostic = error => {
  let message = `${error?.name ?? 'Error'}: ${error?.message ?? ''}`;
  for (const secret of diagnosticRedactions) message = message.replaceAll(secret, '[redacted]');
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[redacted database URL]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, value => safePath(value))
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]')
    .split('\n').slice(0, 4).join('\n').slice(0, 1200);
};
const check = async (label, work) => {
  currentCheck = label;
  await work();
  results.push(label);
};
const browser = await chromium.launch({ headless: true });
let context;
let page;
const deliveredBodies = [];
let scriptCount = 0;
const observePage = observedPage => observedPage.on('response', response => {
  const path = new URL(response.url()).pathname;
  if (response.status() >= 300 && response.status() < 400) {
    const location = response.headers().location;
    if (location) redirects.push({ status: response.status(), from: safePath(response.url()), to: safePath(location), check: currentCheck });
  }
  if (path.startsWith('/api/auth/')) probes.push({ path, status: response.status() });
  if (/^\/(?:api\/v1\/)?models\/[a-f0-9-]{36}(?:\/calendar)?$/.test(path)) {
    probes.push({ path: safePath(response.url()), status: response.status() });
  }
  const kind = response.request().resourceType();
  if (kind === 'script') scriptCount++;
  // Read while each response is available, before a later navigation can
  // evict it from Chromium's resource buffer. Retain only a boolean.
  if (['document', 'script'].includes(kind)) deliveredBodies.push(response.body()
    .then(body => !body.includes(Buffer.from(process.env.BROWSER_SECRET_SENTINEL)))
    .catch(() => false));
});
try {
  const password = randomBytes(24).toString('base64url');
  const email = `browser-${randomUUID()}@example.invalid`;
  const pendingEmail = `pending-${randomUUID()}@example.invalid`;
  for (const secret of [password, email, pendingEmail]) diagnosticRedactions.add(secret);
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
INSERT INTO relay_binding (org_id, model_id, channel, chat_ref, enabled)
VALUES (:'org', :'model', 'telegram', '@fixture_channel', true);
UPDATE auth_user SET org_id = :'org' WHERE email = :'email' AND org_id IS NULL AND role = 'operator';
SELECT count(*) FROM auth_user WHERE email = :'email' AND org_id = :'org' AND role = 'operator';
COMMIT;
` });
    expect(seeded.status).toBe(0);
    expect(seeded.stdout.trim()).toBe('1');
  });
  context = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  observePage(page);
  const status = async path => {
    const value = await page.evaluate(async path => (await fetch(path, { cache: 'no-store' })).status, path);
    probes.push({ path: path.replace(/[a-f0-9-]{36}/g, '<fixture-id>'), status: value });
    return value;
  };
  const linkbioRequest = async (path, method = 'GET', body = undefined) => page.evaluate(async args => {
    const response = await fetch(args.path, {
      method: args.method,
      cache: 'no-store',
      headers: {
        ...(args.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(args.method === 'GET' ? {} : { 'Idempotency-Key': args.key }),
      },
      ...(args.body === undefined ? {} : { body: JSON.stringify(args.body) }),
    });
    let data;
    try { data = await response.json(); } catch { data = null; }
    return { status: response.status, data };
  }, { path, method, body, key: randomUUID() });
  const signIn = async (identity, suppliedPassword) => {
    // These are separate user scenarios, not a rate-limit load test. Let the
    // unchanged auth bucket (20 tokens, 1/sec) fully refill and Better Auth's
    // 10-second credential window expire. Never retry a failed credential POST.
    await delay(21_000);
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(identity);
    await page.getByLabel('Password', { exact: true }).fill(suppliedPassword);
    const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/sign-in/email'
      && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    return response;
  };
  const signOut = async () => {
    // Workspace navigation/prefetch also resolves sessions through the auth
    // routes. Test revocation after the unchanged auth budget has recovered.
    await delay(21_000);
    const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/sign-out'
      && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sign out', exact: true }).first().click();
    expect((await response).status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
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
    expect((await signIn(email, 'deliberately-wrong-password')).status()).toBe(401);
    await expect(page.locator('form').getByRole('alert')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/login');
    expect(await status('/api/v1/models')).toBe(401);
  });
  await check('unassigned identity pending', async () => {
    expect((await signIn(pendingEmail, password)).status()).toBe(200);
    if (mode === 'negative-cookie') {
      await expect(page.locator('form').getByRole('alert')).toContainText('browser session could not be confirmed');
      expect((await context.cookies(origin)).some(cookie => cookie.name.includes('session_token'))).toBe(false);
      faultObserved = true;
    }
    await expect(page.getByRole('heading', { name: 'Workspace access pending' })).toBeVisible();
    expect(await status('/api/v1/models')).toBe(401);
  });
  await signOut();
  await check('browser session retained', async () => {
    expect((await signIn(email, password)).status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Visible fixture talent', exact: true })).toBeVisible();
  });
  await check('session cookie is secure and HttpOnly', async () => {
    const cookies = await context.cookies(origin);
    expect(cookies.some(cookie => cookie.name.includes('session_token') && cookie.secure && cookie.httpOnly)).toBe(true);
  });
  await check('workspace restored after reload', async () => {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Visible fixture talent', exact: true })).toBeVisible();
    await expect(page.getByText('Hidden other tenant talent', { exact: true })).toHaveCount(0);
  });
  await check('talent navigation starts in a fresh authenticated context', async () => {
    // The preceding auth checks intentionally sign out and back in. Carry the verified
    // session into a clean client router so anonymous prefetch results cannot leak into this journey.
    const cookies = await context.cookies(origin);
    expect(cookies.some(cookie => cookie.name.includes('session_token') && cookie.secure && cookie.httpOnly)).toBe(true);
    await Promise.all(deliveredBodies);
    await context.close();
    // Earlier anonymous checks share one fixture IP and auth bucket; let it refill before UI prefetches.
    await delay(21_000);
    context = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
    await context.addCookies(cookies);
    page = await context.newPage();
    observePage(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Visible fixture talent', exact: true })).toBeVisible();
    expect(await status('/api/v1/models')).toBe(200);
  });
  await check('talent profile route opens from the roster', async () => {
    await page.locator('a.model-link').filter({ hasText: 'Visible fixture talent' }).click();
    await expect(page).toHaveURL(new RegExp(`/models/${ownModel}$`));
  });
  await check('talent profile renders its model heading', async () => {
    await expect(page.getByRole('heading', { name: 'Visible fixture talent', exact: true })).toBeVisible();
  });
  const scheduleAction = page.locator(`.page-stack > .grid a[href="/models/${ownModel}/calendar"]`);
  await check('talent profile exposes View schedule', async () => {
    await expect(scheduleAction).toHaveText('View schedule');
  });
  await check('View schedule navigates to its calendar route', async () => {
    await scheduleAction.click();
    await expect(page).toHaveURL(new RegExp(`/models/${ownModel}/calendar(?:\\?.*)?$`));
  });
  await check('calendar route renders its page heading', async () => {
    await expect(page.getByRole('heading', { name: 'Content calendar', exact: true })).toBeVisible();
  });
  await check('calendar route has no server exception', async () => {
    await expect(page.getByText('Application error: a server-side exception has occurred')).toHaveCount(0);
  });
  await check('link-in-bio starts with zero configured providers', async () => {
    await page.goto(`/models/${ownModel}/linkbio`);
    const response = await linkbioRequest(`/api/v1/models/${ownModel}/linkbio`);
    expect(response.status).toBe(200);
    expect(response.data.data.providers.filter(provider => provider.enabled)).toEqual([]);
  });
  await check('Native provider and tracked destination can be configured from the dashboard', async () => {
    await page.getByLabel('Link label').fill('Synthetic destination');
    await page.getByLabel('Link URL').fill('https://example.invalid/synthetic-destination');
    await page.getByRole('button', { name: 'Add link' }).click();
    await page.getByRole('button', { name: 'Enable provider' }).click();
    const row = page.getByRole('row').filter({ hasText: 'native' });
    await expect(row).toContainText('Configured');
    const savedLink = page.getByRole('listitem').filter({ hasText: 'Synthetic destination' });
    await expect(savedLink).toContainText('https://example.invalid/synthetic-destination');
    expect(await status(`/linkbio/${ownModel}`)).toBe(200);
  });
  await check('Fanlynks, Linktree, and Beacons each configure independently with honest capability readback', async () => {
    const path = `/api/v1/models/${ownModel}/linkbio`;
    const nativeDisabled = await linkbioRequest(`${path}/native`, 'DELETE');
    expect(nativeDisabled.status).toBe(200);
    const independent = [
      { kind: 'fanlynks', config: { links: [{ label: 'Fanlynks test', url: 'https://example.invalid/fanlynks' }] } },
      { kind: 'linktree', profileUrl: 'https://linktr.ee/synthetic_creator', config: { links: [{ label: 'Linktree test', url: 'https://example.invalid/linktree' }] } },
      { kind: 'beacons', profileUrl: 'https://synthetic-creator.beacons.ai/', config: { links: [{ label: 'Beacons test', url: 'https://example.invalid/beacons' }] } },
    ];
    for (const provider of independent) {
      const saved = await linkbioRequest(path, 'POST', { ...provider, isPrimary: true });
      expect(saved.status).toBe(201);
      const current = await linkbioRequest(path);
      const active = current.data.data.providers.filter(entry => entry.enabled);
      expect(active.map(entry => entry.kind)).toEqual([provider.kind]);
      expect(active[0].config.links.length).toBe(1);
      expect(active[0].config.links[0].path).toContain(`/linkbio/${provider.kind}/`);
      if (provider.kind === 'fanlynks') {
        expect(active[0].integration).toMatchObject({ state: 'configured', linkManagement: 'first_party' });
        expect(await status(`/linkbio/fanlynks/${ownModel}`)).toBe(200);
      } else {
        expect(active[0].integration).toMatchObject({ state: 'unavailable', linkManagement: 'manual', revocation: 'manual' });
      }
      const disabled = await linkbioRequest(`${path}/${provider.kind}`, 'DELETE');
      expect(disabled.status).toBe(200);
      expect(disabled.data.data.enabled).toBe(false);
    }
    const empty = await linkbioRequest(path);
    expect(empty.data.data.providers.filter(entry => entry.enabled)).toEqual([]);
  });
  await check('all four providers compose, primary selection is exclusive, and external APIs stay honestly unavailable', async () => {
    const path = `/api/v1/models/${ownModel}/linkbio`;
    const native = await linkbioRequest(path, 'POST', {
      kind: 'native', isPrimary: false,
      config: { links: [{ label: 'Synthetic destination', url: 'https://example.invalid/synthetic-destination' }] },
    });
    expect(native.status).toBe(201);
    const providers = [
      { kind: 'fanlynks', config: { links: [{ label: 'Fanlynks test', url: 'https://example.invalid/fanlynks' }] } },
      { kind: 'linktree', profileUrl: 'https://linktr.ee/synthetic_creator', config: { links: [{ label: 'Linktree test', url: 'https://example.invalid/linktree' }] } },
      { kind: 'beacons', profileUrl: 'https://synthetic-creator.beacons.ai/', config: { links: [{ label: 'Beacons test', url: 'https://example.invalid/beacons' }] }, isPrimary: true },
    ];
    for (const provider of providers) {
      const response = await linkbioRequest(path, 'POST', { isPrimary: false, ...provider });
      expect(response.status).toBe(201);
    }
    const configured = await linkbioRequest(path, 'POST', {
      kind: 'linktree', profileUrl: 'https://linktr.ee/synthetic_creator', isPrimary: true,
      config: { links: [{ label: 'Linktree test', url: 'https://example.invalid/linktree' }] },
    });
    expect(configured.status).toBe(201);
    const readback = await linkbioRequest(path);
    expect(readback.status).toBe(200);
    const active = readback.data.data.providers.filter(provider => provider.enabled);
    expect(active.map(provider => provider.kind).sort()).toEqual(['beacons', 'fanlynks', 'linktree', 'native']);
    expect(readback.data.data.primary.kind).toBe('linktree');
    expect(active.find(provider => provider.kind === 'linktree').integration).toMatchObject({
      state: 'unavailable', reason: 'linktree_partner_access_required', linkManagement: 'manual', revocation: 'manual',
    });
    expect(active.find(provider => provider.kind === 'beacons').integration).toMatchObject({
      state: 'unavailable', reason: 'beacons_api_endpoints_unavailable', linkManagement: 'manual', revocation: 'manual',
    });
    expect(active.filter(provider => ['native', 'fanlynks'].includes(provider.kind))
      .every(provider => provider.integration.state === 'configured')).toBe(true);
    expect(active.every(provider => provider.config.links.every(link => typeof link.path === 'string'))).toBe(true);
  });
  await check('disabling one provider preserves the other pages and native public link', async () => {
    const response = await linkbioRequest(`/api/v1/models/${ownModel}/linkbio/beacons`, 'DELETE');
    expect(response.status).toBe(200);
    expect(response.data.data.integration).toMatchObject({ state: 'unavailable', reason: 'provider_disabled' });
    const readback = await linkbioRequest(`/api/v1/models/${ownModel}/linkbio`);
    expect(readback.data.data.providers.filter(provider => provider.enabled).map(provider => provider.kind).sort())
      .toEqual(['fanlynks', 'linktree', 'native']);
    const nativePage = await status(`/linkbio/${ownModel}`);
    expect(nativePage).toBe(200);
  });
  await check('Relay destination action label stays readable on mobile', async () => {
    await page.goto(`/models/${ownModel}/relay`);
    const disableAction = page.getByRole('button', { name: 'Disable', exact: true });
    await expect(disableAction).toBeVisible();
    const renderedLines = await disableAction.evaluate(button => {
      const range = document.createRange();
      range.selectNodeContents(button);
      return range.getClientRects().length;
    });
    expect(renderedLines).toBe(1);
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
    await signOut();
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
} catch (error) {
  // Never dump Playwright call logs, credential form values, cookies or HTML.
  const expected = mode === 'negative-brand' ? 'rendered brand and metadata'
    : mode === 'negative-cookie' ? 'unassigned identity pending' : null;
  if (expected && faultObserved && currentCheck === expected) {
    console.log(JSON.stringify({ mode, passed: results.length, failed: 1, skipped: 0, expectedFailure: currentCheck }));
  } else {
    console.error(JSON.stringify({ mode, passed: results.length, failed: 1, skipped: 0, failure: currentCheck,
      failureDetail: safeDiagnostic(error), currentPath: page ? safePath(page.url()) : '<not-available>', probes, redirects }));
    process.exitCode = 1;
  }
} finally {
  await context?.close();
  await browser.close();
  proxy.closeAllConnections();
  await new Promise(resolve => proxy.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}
