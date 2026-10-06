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
let failureContext = null;
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
  const fixtureSql = (input, variables = {}) => {
    const result = spawnSync('psql', ['-X', '-q', '-t', '-A', '-d', database.href, '-v', 'ON_ERROR_STOP=1',
      ...Object.entries(variables).flatMap(([name, value]) => ['-v', `${name}=${value}`])],
    { encoding: 'utf8', timeout: 15000, input });
    if (result.status !== 0) {
      const detail = safeDiagnostic(new Error([
        result.stderr?.trim(),
        result.error?.message,
        `psql exited ${result.status}`,
      ].filter(Boolean).join('\n')));
      throw new Error(`Disposable browser fixture SQL failed: ${detail}`);
    }
    return result.stdout.trim();
  };
  const createRoleplayActor = () => {
    const actorRef = `browser-llm-${randomUUID()}`;
    const shiftId = randomUUID();
    const inserted = fixtureSql(`
INSERT INTO agent_permission (org_id, agent_ref, model_id, tier, can_publish, can_edit)
VALUES (:'org', :'agent', :'model', 'operator', false, true);
INSERT INTO team_shift (id, org_id, model_id, assignee_type, assignee_user_id, assignee_agent_ref, queue, starts_at, ends_at, status)
VALUES (:'shift', :'org', :'model', 'llm', NULL, :'agent', 'chatter', statement_timestamp() - interval '1 minute', statement_timestamp() + interval '1 hour', 'active');
SELECT id FROM team_shift WHERE id = :'shift';
`, { org, model: ownModel, agent: actorRef, shift: shiftId });
    if (inserted !== shiftId) throw new Error('Disposable roleplay actor was not created');
    return { actorRef, shiftId };
  };
  const removeRoleplayActor = ({ actorRef, shiftId }) => {
    const remaining = fixtureSql(`
BEGIN;
DELETE FROM roleplay_turn
WHERE org_id = :'org' AND model_id = :'model' AND shift_id = :'shift'
  AND actor_type = 'llm' AND actor_ref = :'agent';
DELETE FROM roleplay_handoff
WHERE org_id = :'org' AND model_id = :'model' AND shift_id = :'shift'
  AND actor_type = 'llm' AND actor_ref = :'agent';
DELETE FROM team_shift WHERE id = :'shift' AND org_id = :'org' AND model_id = :'model';
DELETE FROM agent_permission WHERE org_id = :'org' AND model_id = :'model' AND agent_ref = :'agent';
SELECT (SELECT count(*) FROM team_shift WHERE id = :'shift')::text || '|'
  || (SELECT count(*) FROM roleplay_handoff WHERE org_id = :'org' AND model_id = :'model' AND shift_id = :'shift' AND actor_type = 'llm' AND actor_ref = :'agent')::text || '|'
  || (SELECT count(*) FROM roleplay_turn WHERE org_id = :'org' AND model_id = :'model' AND shift_id = :'shift' AND actor_type = 'llm' AND actor_ref = :'agent')::text || '|'
  || (SELECT count(*) FROM agent_permission WHERE org_id = :'org' AND model_id = :'model' AND agent_ref = :'agent')::text;
COMMIT;
`, { org, model: ownModel, agent: actorRef, shift: shiftId });
    if (remaining !== '0|0|0|0') throw new Error('Disposable roleplay actor cleanup was not verified');
  };
  let relayRouteStatus = null;
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
  let syntheticConsentId = null;
  await check('consent vault saves an expired synthetic DNG and proves encrypted-document readback', async () => {
    await page.goto(`/models/${ownModel}/consent`);
    await page.locator('summary').filter({ hasText: 'Add consent metadata' }).click();
    const form = page.locator('form[aria-label="Add consent metadata"]');
    const dng = Buffer.alloc(300 * 1024, 0x5a);
    dng.write('II', 0, 'ascii');
    dng.writeUInt16LE(42, 2);
    dng.writeUInt32LE(8, 4);
    dng.writeUInt16LE(1, 8);
    dng.writeUInt16LE(0xc612, 10);
    dng.writeUInt16LE(1, 12);
    dng.writeUInt32LE(4, 14);
    dng.set([1, 4, 0, 0], 18);
    dng.writeUInt32LE(0, 22);
    await form.locator('input[name="platform"]').fill('instagram');
    await form.locator('select[name="docKind"]').selectOption('id_verify');
    await form.locator('input[name="subjectRef"]').fill('synthetic-consent-subject');
    await form.locator('input[name="document"]').setInputFiles({
      name: 'synthetic-driver-license.dng', mimeType: 'application/octet-stream', buffer: dng,
    });
    await form.locator('input[name="validFrom"]').fill('2020-01-01');
    await form.locator('input[name="expiresAt"]').fill('2020-12-31');
    const upload = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/models/${ownModel}/consent-records`
      && response.request().method() === 'POST');
    await form.getByRole('button', { name: 'Save consent record' }).click();
    const saved = await upload;
    const savedBody = await saved.json();
    expect(saved.status(), JSON.stringify(savedBody)).toBe(201);
    syntheticConsentId = savedBody.data.id;
    expect(savedBody.data).toMatchObject({ hasDocument: true, documentMimeType: 'image/tiff', documentSize: dng.length });
    await expect(form.getByRole('status')).toContainText('Consent record saved with an encrypted document');
    const expiredCard = page.locator('article.card').filter({ hasText: 'synthetic-consent-subject' });
    await expect(expiredCard).toContainText('expired');

    const list = await page.evaluate(async path => {
      const response = await fetch(path, { cache: 'no-store' });
      return { status: response.status, body: await response.json() };
    }, `/api/v1/models/${ownModel}/consent-records`);
    expect(list.status).toBe(200);
    const record = list.body.data.find(entry => entry.id === syntheticConsentId);
    expect(record).toMatchObject({ hasDocument: true, documentMimeType: 'image/tiff', documentSize: dng.length, expiresAt: '2020-12-31T23:59:59.999Z' });
    expect(Object.keys(record)).not.toContain('documentCiphertext');
    expect(record.sha256).toMatch(/^[a-f0-9]{64}$/);

    const downloaded = await page.evaluate(async path => {
      const response = await fetch(path, { cache: 'no-store' });
      return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        cacheControl: response.headers.get('cache-control'),
        bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
      };
    }, `/api/v1/models/${ownModel}/consent-records/${syntheticConsentId}/document`);
    expect(downloaded).toMatchObject({ status: 200, contentType: 'image/tiff' });
    expect(downloaded.cacheControl).toContain('no-store');
    expect(downloaded.bytes).toEqual(Array.from(dng));
    const publishStatus = await linkbioRequest(`/api/v1/models/${ownModel}/consent-status?platform=instagram`);
    expect(publishStatus.status).toBe(200);
    expect(publishStatus.data.data.ok).toBe(false);
    expect(await status(`/api/v1/models/${otherModel}/consent-records/${syntheticConsentId}/document`)).toBe(404);
  });
  await check('roleplay explains missing assignments, saves persona, and persists a handoff only after a synthetic active actor exists', async () => {
    const roleplayUrl = `/models/${ownModel}/roleplay`;
    await page.goto(roleplayUrl);
    await expect(page.getByText('Handoff and context reload need an active assigned shift.', { exact: false })).toBeVisible();
    const actorHelp = page.locator('p.notice').filter({ hasText: 'Handoff and context reload need an active assigned shift.' });
    const assignmentLink = actorHelp.getByRole('link');
    await expect(assignmentLink).toBeVisible();
    const assignmentHref = await assignmentLink.getAttribute('href');
    const assignmentPath = assignmentHref
      ? decodeURIComponent(new URL(assignmentHref, page.url()).pathname).replace(/\/+$/, '')
      : null;
    expect(assignmentPath, `Unexpected actor assignment destination: ${assignmentHref}`).toBe(`/models/${ownModel}/team`);
    const reloadContext = page.getByRole('button', { name: 'Reload bounded context' });
    const summary = page.getByLabel('Last safe summary');
    const nextAction = page.getByLabel('Allowed next action');
    await expect(reloadContext).toBeDisabled();
    await expect(summary).toBeDisabled();
    await expect(nextAction).toBeDisabled();
    const persona = page.getByPlaceholder('Write bounded character guidance…');
    await expect(persona).toBeEnabled();
    await persona.fill('Synthetic persona guidance used only by this disposable browser test.');
    const personaSave = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/models/${ownModel}/roleplay/persona`
      && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Save new persona revision' }).click();
    const personaResponse = await personaSave;
    const personaBody = await personaResponse.json();
    expect([200, 201], `Persona save rejected: ${JSON.stringify(personaBody)}`).toContain(personaResponse.status());
    const personaReadback = await page.evaluate(async path => {
      const response = await fetch(path, { cache: 'no-store' });
      return { status: response.status, body: await response.json() };
    }, `/api/v1/models/${ownModel}/roleplay/persona`);
    expect(personaReadback).toMatchObject({ status: 200, body: { data: { revision: 1, content: 'Synthetic persona guidance used only by this disposable browser test.' } } });

    const fixtureActor = createRoleplayActor();
    try {
      await page.reload();
      const actorSelect = page.getByLabel('Active actor');
      await expect(actorSelect).toHaveValue(`llm:${fixtureActor.actorRef}`);
      await expect(reloadContext).toBeEnabled();
      const contextRead = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/models/${ownModel}/roleplay`
        && response.request().method() === 'GET');
      await reloadContext.click();
      expect((await contextRead).status()).toBe(200);
      await expect(summary).toBeEnabled();
      await expect(nextAction).toBeEnabled();
      await summary.fill('Synthetic handoff summary; no provider turn was requested.');
      await nextAction.fill('Review the fixture only.');
      const handoffSave = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/models/${ownModel}/roleplay/handoff`
        && response.request().method() === 'PUT');
      await page.getByRole('button', { name: 'Save handoff' }).click();
      const handoffResponse = await handoffSave;
      const handoffBody = await handoffResponse.json();
      expect([200, 201], `Handoff save rejected: ${JSON.stringify(handoffBody)}`).toContain(handoffResponse.status());
      const contextReadback = await page.evaluate(async args => {
        const query = new URLSearchParams({ actorType: 'llm', actorRef: args.actorRef });
        const response = await fetch(`/api/v1/models/${args.modelId}/roleplay?${query}`, { cache: 'no-store' });
        return { status: response.status, body: await response.json() };
      }, { modelId: ownModel, actorRef: fixtureActor.actorRef });
      expect(contextReadback.status).toBe(200);
      expect(contextReadback.body.data).toMatchObject({
        meta: { activeShiftId: fixtureActor.shiftId, actor: { type: 'llm', ref: fixtureActor.actorRef } },
        handoff: { lastSafeSummary: 'Synthetic handoff summary; no provider turn was requested.', allowedNextAction: 'Review the fixture only.' },
      });
    } finally {
      removeRoleplayActor(fixtureActor);
    }
  });
  await check('Patreon and Snapchat missing credentials return a safe in-app explanation', async () => {
    for (const platform of ['patreon', 'snapchat']) {
      await page.goto(`/models/${ownModel}/network`);
      const authorize = page.locator(`a[href^="/api/v1/connectors/${platform}/authorize?"]`);
      await expect(authorize).toBeVisible();
      const redirect = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/connectors/${platform}/authorize`);
      await authorize.click();
      expect((await redirect).status()).toBe(303);
      await expect(page).toHaveURL(new RegExp(`/models/${ownModel}/network\\?oauth=unavailable&platform=${platform}$`));
      const providerName = platform === 'patreon' ? 'Patreon' : 'Snapchat';
      await expect(page.locator('p[role="alert"]').filter({ hasText: `${providerName} OAuth is not configured on this service` })).toBeVisible();
      await expect(page.locator('body')).not.toContainText('application/problem+json');
    }
  });
  await check('Telegram setup never sends a message before a destination and token are supplied', async () => {
    await page.goto(`/models/${ownModel}/network`);
    const token = page.getByLabel(/^Telegram bot token\b/i);
    const destination = page.getByLabel('Channel username or chat ID', { exact: true });
    await expect(token).toHaveCount(1);
    await expect(destination).toHaveCount(1);
    await expect(token).toHaveValue('');
    await expect(destination).toHaveValue('');
    const connect = page.getByRole('button', { name: 'Connect Telegram bot' });
    await expect(connect).toBeDisabled();
    expect(probes.some(probe => probe.path.includes('/connectTelegram'))).toBe(false);
  });
  await check('scrape explains HTTPS validation and queues a public Instagram fixture without dispatching it', async () => {
    await page.goto(`/models/${ownModel}/scraping`);
    failureContext = await page.evaluate(() => {
      const bodyText = document.body?.innerText ?? '';
      const labels = Array.from(document.querySelectorAll('label'));
      const form = document.querySelector('fieldset');
      return {
        hasExpectedHeading: bodyText.includes('Trend & competitor radar'),
        hasStartForm: bodyText.includes('Start a research run'),
        hasLoadFailure: bodyText.includes('Research runs could not be loaded'),
        hasNoRuns: bodyText.includes('No scraper runs yet'),
        hasProfileUrlLabel: labels.some(label => label.textContent?.includes('Public HTTPS profile URL')),
        labelCount: labels.length,
        inputTypes: Array.from(document.querySelectorAll('input')).map(input => input.type),
        formDisabled: form instanceof HTMLFieldSetElement ? form.disabled : null,
      };
    });
    const profileUrl = page.getByLabel('Public HTTPS profile URL');
    const scrapePath = `/api/v1/models/${ownModel}/scrape-runs`;
    const scrapePosts = [];
    const onScrapeRequest = request => {
      const url = new URL(request.url());
      if (url.pathname === scrapePath && request.method() === 'POST') scrapePosts.push(url.pathname);
    };
    page.on('request', onScrapeRequest);
    await profileUrl.fill('http://127.0.0.1/private-fixture');
    await page.getByRole('button', { name: 'Queue scrape' }).click();
    await expect(page.locator('p[role="alert"]')).toHaveText('Use a profile URL that starts with https://. HTTP links cannot be queued.');
    expect(scrapePosts).toHaveLength(0);
    failureContext = { ...failureContext, scrapePostsAfterHttpUrl: scrapePosts.length };
    const history = await page.evaluate(async path => {
      const response = await fetch(path, { cache: 'no-store' });
      return { status: response.status, body: await response.json() };
    }, scrapePath);
    expect(history).toMatchObject({ status: 200, body: { data: [] } });

    await profileUrl.fill('https://www.instagram.com/synthetic-public-profile');
    const queue = page.waitForResponse(response => new URL(response.url()).pathname === scrapePath
      && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Queue scrape' }).click();
    const queuedResponse = await queue;
    const queuedPayload = await queuedResponse.json().catch(() => null);
    if (queuedResponse.status() !== 202) {
      const detail = queuedPayload && typeof queuedPayload.detail === 'string' ? queuedPayload.detail : 'No public problem detail';
      failureContext = {
        ...failureContext,
        scrapeQueueStatus: queuedResponse.status(),
        scrapeQueueContentType: queuedResponse.headers()['content-type'] ?? null,
        scrapeQueueProblem: safeDiagnostic(new Error(detail)),
      };
    }
    expect(queuedResponse.status()).toBe(202);
    expect(scrapePosts).toHaveLength(1);
    expect(queuedPayload).toMatchObject({ data: { kind: 'social', state: 'queued', modelId: ownModel, error: null } });
    const queuedHistory = await page.evaluate(async path => {
      const response = await fetch(path, { cache: 'no-store' });
      return { status: response.status, body: await response.json() };
    }, scrapePath);
    expect(queuedHistory).toMatchObject({ status: 200, body: { data: [{ kind: 'social', state: 'queued', error: null }] } });
    page.off('request', onScrapeRequest);
    failureContext = null;
  });
  await check('automation page states its value in plain language instead of implementation jargon', async () => {
    await page.goto(`/models/${ownModel}/triggers`);
    const renderedDescription = await page.locator('.card p.subtle').first().innerText().catch(() => '<missing>');
    const routeDiagnostics = renderedDescription === '<missing>'
      ? await page.evaluate(async modelId => {
          const read = async (label, path) => {
            const response = await fetch(path, { cache: 'no-store' });
            const body = await response.json().catch(() => null);
            return {
              label,
              status: response.status,
              detail: typeof body?.detail === 'string' ? body.detail.slice(0, 300)
                : typeof body?.error?.message === 'string' ? body.error.message.slice(0, 300) : null,
            };
          };
          const [sessionResponse, rules, social] = await Promise.all([
            fetch('/api/auth/get-session', { cache: 'no-store' }),
            read('trigger-rules', `/api/v1/models/${encodeURIComponent(modelId)}/trigger-rules`),
            read('social-accounts', `/api/v1/social-accounts?modelId=${encodeURIComponent(modelId)}`),
          ]);
          const session = await sessionResponse.json().catch(() => null);
          return {
            sessionStatus: sessionResponse.status,
            sessionRole: session?.user?.role ?? null,
            hasWorkspace: Boolean(session?.user?.orgId),
            rules,
            social,
          };
        }, ownModel)
      : null;
    failureContext = {
      pageLocale: await page.locator('html').getAttribute('lang'),
      automationDescription: safeDiagnostic(new Error(renderedDescription)),
      pageTitle: safeDiagnostic(new Error(await page.title())),
      renderedPage: safeDiagnostic(new Error(await page.locator('body').innerText().catch(() => '<missing>'))),
      ...(routeDiagnostics ? {
        routeDiagnostics: {
          ...routeDiagnostics,
          rules: { ...routeDiagnostics.rules, detail: routeDiagnostics.rules.detail ? safeDiagnostic(new Error(routeDiagnostics.rules.detail)) : null },
          social: { ...routeDiagnostics.social, detail: routeDiagnostics.social.detail ? safeDiagnostic(new Error(routeDiagnostics.social.detail)) : null },
        },
      } : {}),
    };
    await expect(page.getByText('Choose a platform, what to measure (such as likes, comments, or views), and a target.', { exact: false })).toBeVisible();
    await expect(page.getByText('without checking every post by hand', { exact: false })).toBeVisible();
    await expect(page.getByText('Generated content still needs approval before it can be published.', { exact: false })).toBeVisible();
    const thresholdMode = page.getByLabel('How should the target be set?');
    await thresholdMode.selectOption('learned_p90');
    await expect(thresholdMode).toHaveValue('learned_p90');
    await expect(thresholdMode.locator('option:checked')).toHaveText('Compare with recent performance');
    await expect(page.getByText(/top 10% level of recent results/)).toBeVisible();
    await expect(page.getByText(/Learned p90|worker gates|kill-switch/)).toHaveCount(0);
    failureContext = null;
  });
  await check('link-in-bio starts with zero configured providers', async () => {
    await page.goto(`/models/${ownModel}/linkbio`);
    const response = await linkbioRequest(`/api/v1/models/${ownModel}/linkbio`);
    expect(response.status).toBe(200);
    expect(response.data.data.providers.filter(provider => provider.enabled)).toEqual([]);
  });
  await check('Native provider and tracked destination can be configured from the dashboard', async () => {
    const renderState = await page.evaluate(async () => {
      const response = await fetch('/api/auth/get-session', { cache: 'no-store' });
      const session = await response.json().catch(() => null);
      return {
        sessionStatus: response.status,
        sessionRole: session?.user?.role ?? null,
        hasWorkspace: Boolean(session?.user?.orgId),
        title: document.title,
        bodyText: (document.body?.innerText ?? '').slice(0, 1600),
        labeledInputs: Array.from(document.querySelectorAll('input')).map(input => ({
          label: input.getAttribute('aria-label'),
          type: input.type,
          disabled: input.disabled,
          visible: input.getClientRects().length > 0,
        })),
      };
    });
    failureContext = {
      sessionStatus: renderState.sessionStatus,
      sessionRole: renderState.sessionRole,
      hasWorkspace: renderState.hasWorkspace,
      pageTitle: safeDiagnostic(new Error(renderState.title)),
      renderedBody: safeDiagnostic(new Error(renderState.bodyText)),
      labeledInputs: renderState.labeledInputs,
    };
    expect(renderState.sessionStatus).toBe(200);
    expect(renderState.sessionRole).toBe('operator');
    await expect(page.getByLabel('Link label')).toBeVisible();
    await page.getByLabel('Link label').fill('Synthetic destination');
    await page.getByLabel('Link URL').fill('https://example.invalid/synthetic-destination');
    await page.getByRole('button', { name: 'Add link' }).click();
    const saveResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/models/${ownModel}/linkbio`
      && response.request().method() === 'POST', { timeout: 10_000 }).catch(() => null);
    await page.getByRole('button', { name: 'Enable provider' }).click();
    const saveResponse = await saveResponsePromise;
    const saveBody = saveResponse ? await saveResponse.json().catch(() => null) : null;
    const savedReadback = saveResponse?.status() === 201 ? await linkbioRequest(`/api/v1/models/${ownModel}/linkbio`) : null;
    const nativeProvider = savedReadback?.data?.data?.providers?.find(provider => provider.kind === 'native');
    failureContext = {
      saveStatus: saveResponse?.status() ?? null,
      saveDetail: typeof saveBody?.detail === 'string' ? safeDiagnostic(new Error(saveBody.detail))
        : typeof saveBody?.error?.message === 'string' ? safeDiagnostic(new Error(saveBody.error.message)) : null,
      saveProvider: saveBody?.data ? {
        kind: saveBody.data.kind,
        enabled: saveBody.data.enabled,
        integrationState: saveBody.data.integration?.state ?? null,
      } : null,
      readbackStatus: savedReadback?.status ?? null,
      readbackProvider: nativeProvider ? {
        enabled: nativeProvider.enabled,
        integrationState: nativeProvider.integration?.state ?? null,
        linkCount: nativeProvider.config?.links?.length ?? null,
      } : null,
      renderedRows: await page.getByRole('row').allInnerTexts().catch(() => []),
      visibleAlerts: await page.locator('[role="alert"]').allInnerTexts().catch(() => []),
    };
    expect(saveResponse?.status(), JSON.stringify(failureContext)).toBe(201);
    expect(savedReadback?.status, JSON.stringify(failureContext)).toBe(200);
    expect(nativeProvider, JSON.stringify(failureContext)).toMatchObject({ enabled: true, integration: { state: 'configured' } });
    const row = page.getByRole('row').filter({ hasText: 'native' });
    await expect(row).toContainText('Configured');
    const savedLink = page.getByRole('listitem').filter({ hasText: 'Synthetic destination' });
    await expect(savedLink).toContainText('https://example.invalid/synthetic-destination');
    expect(await status(`/linkbio/${ownModel}`)).toBe(200);
    failureContext = null;
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
    await page.setViewportSize({ width: 390, height: 844 });
    const response = await page.goto(`/models/${ownModel}/relay`);
    relayRouteStatus = response?.status() ?? null;
    const relayBindings = await linkbioRequest(`/api/v1/models/${ownModel}/relay-bindings`);
    const disableAction = page.getByRole('button', { name: 'Disable', exact: true });
    const actionButtons = page.locator('table tbody tr td:last-child > button');
    const sessionSummary = await page.evaluate(async () => {
      const response = await fetch('/api/auth/get-session', { cache: 'no-store' });
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      return {
        status: response.status,
        role: typeof body?.user?.role === 'string' ? body.user.role : null,
      };
    });
    failureContext = {
      pageStatus: response?.status() ?? null,
      apiStatus: relayBindings.status,
      apiBindingCount: Array.isArray(relayBindings.data?.data) ? relayBindings.data.data.length : null,
      sessionSummary,
      viewportWidth: await page.evaluate(() => window.innerWidth),
      tableCount: await page.locator('table').count(),
      tableHeaderCount: await page.locator('table thead th').count(),
      rowCount: await page.locator('table tbody tr').count(),
      editableFieldsetCount: await page.locator('table + fieldset').count(),
      actionButtonCount: await actionButtons.count(),
      exactDisableTextCount: await actionButtons.evaluateAll(buttons => buttons.filter(button => button.textContent?.replace(/\s+/g, ' ').trim() === 'Disable').length),
      accessibleDisableCount: await disableAction.count(),
    };
    expect(relayBindings.status).toBe(200);
    expect(relayBindings.data?.data).toHaveLength(1);
    expect(relayBindings.data.data[0]).toMatchObject({ channel: 'telegram', enabled: true });
    await expect(disableAction).toBeVisible();
    const renderedLines = await disableAction.evaluate(button => {
      const range = document.createRange();
      range.selectNodeContents(button);
      return range.getClientRects().length;
    });
    expect(renderedLines).toBe(1);
    await page.setViewportSize({ width: 1440, height: 1000 });
    failureContext = null;
  });
  await check('all six supported interface languages save and read back in the settings UI', async () => {
    await page.goto('/settings');
    const localeForm = page.locator('form').first();
    const localeSelect = localeForm.locator('select');
    await expect(localeSelect).toHaveCount(1);
    for (const locale of ['en', 'es', 'ja', 'it', 'pt-BR', 'de']) {
      await localeSelect.selectOption(locale);
      const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/ui-locale'
        && response.request().method() === 'PATCH');
      await localeForm.locator('button[type="submit"]').click();
      expect((await saved).status()).toBe(200);
      const readback = await page.evaluate(async () => {
        const response = await fetch('/api/v1/ui-locale', { cache: 'no-store' });
        return { status: response.status, body: await response.json() };
      });
      expect(readback).toMatchObject({ status: 200, body: { data: { locale, userLocale: locale } } });
      await expect(localeSelect).toHaveValue(locale);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
    }
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
    const brandWordmarks = page.locator('.brand-wordmark');
    failureContext = {
      viewportWidth: await page.evaluate(() => window.innerWidth),
      relayRouteStatus,
      pageStructure: await page.evaluate(() => {
        const bodyText = document.body?.innerText ?? '';
        return {
          appShellCount: document.querySelectorAll('.app-shell').length,
          sidebarCount: document.querySelectorAll('.sidebar').length,
          mobileBarCount: document.querySelectorAll('.mobile-bar').length,
          authShellCount: document.querySelectorAll('.auth-shell').length,
          mainCount: document.querySelectorAll('main').length,
          loginFormCount: document.querySelectorAll('form').length,
          hasRelayContent: /relay/i.test(bodyText),
          hasApplicationError: bodyText.includes('Application error: a server-side exception has occurred'),
          hasWorkspacePending: bodyText.includes('Workspace access pending'),
        };
      }),
      brandWordmarks: await brandWordmarks.evaluateAll(nodes => nodes.map(node => ({
        text: (node.textContent ?? '').slice(0, 100),
        parentClass: node.parentElement?.className ?? null,
        display: getComputedStyle(node.parentElement ?? node).display,
      }))),
    };
    await expect(page.locator('.brand-wordmark:visible').first()).toHaveText(name);
    if (tagline) await expect(page.locator('.sidebar .brand-copy small')).toHaveText(tagline);
    expect(await page.locator('body').innerText()).not.toContain('Hidden other tenant talent');
    failureContext = null;
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
      failureDetail: safeDiagnostic(error), failureContext, currentPath: page ? safePath(page.url()) : '<not-available>', probes, redirects }));
    process.exitCode = 1;
  }
} finally {
  await context?.close();
  await browser.close();
  proxy.closeAllConnections();
  await new Promise(resolve => proxy.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}
