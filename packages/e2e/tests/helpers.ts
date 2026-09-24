// ─── E2E test helpers ───────────────────────────────────────────────────────
// Shared fixtures for the AXIOM end-to-end suite. Everything here runs
// against the ephemeral test database/stack only; helpers.psql refuses to
// touch anything that looks like a fanthynks.com database.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';

export const E2E_ORG_ID = '22222222-2222-4222-8222-222222222222';
export const E2E_ORG_SLUG = 'e2e-test-org';

export interface TestUser {
  name: string;
  email: string;
  password: string;
}

export function makeUser(prefix = 'E2E Operator'): TestUser {
  const rand = Math.random().toString(36).slice(2, 10);
  return {
    name: `${prefix} ${rand}`,
    email: `e2e+${Date.now()}-${rand}@e2e.axiom.local`,
    password: `s3cure-Pass-${rand}!`,
  };
}

/** Run a SQL statement against the ephemeral E2E database via psql. */
export function psql(sql: string): string {
  const url = process.env.E2E_MIGRATOR_DATABASE_URL ?? process.env.MIGRATOR_DATABASE_URL ?? '';
  if (!url) throw new Error('helpers.psql: E2E_MIGRATOR_DATABASE_URL is required');
  if (/fanthynks\.com/i.test(url)) {
    throw new Error('helpers.psql: refusing to touch a fanthynks.com database');
  }
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-Atq', url, '-c', sql], {
    encoding: 'utf8',
  }).trim();
}

function sqlEscape(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Attach a freshly signed-up user to the seeded E2E org. The app assigns no
 * org at sign-up time by design (orgId is input:false), so tests do this
 * directly in the ephemeral database.
 */
export function attachUserToE2EOrg(email: string): string {
  const out = psql(
    `UPDATE auth_user SET org_id='${E2E_ORG_ID}' WHERE email='${sqlEscape(email)}' RETURNING id;`,
  );
  if (!out) throw new Error(`helpers.attachUserToE2EOrg: no user found for ${email}`);
  return out;
}

/**
 * Create an account through the real sign-up endpoint (same path the
 * dashboard login form's fetch would take: /api/auth/* rewrites to the API).
 */
export async function signUpViaApi(
  request: APIRequestContext,
  user: TestUser,
): Promise<{ status: number; body: unknown }> {
  const res = await request.post('/api/auth/sign-up/email', {
    data: { name: user.name, email: user.email, password: user.password },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status(), body };
}

/** Sign a user up via the API, attach them to the E2E org, and return them. */
export async function createOrgUser(request: APIRequestContext, user: TestUser): Promise<TestUser> {
  const { status, body } = await signUpViaApi(request, user);
  if (status !== 200 && status !== 201) {
    throw new Error(`sign-up failed (${status}): ${JSON.stringify(body)}`);
  }
  attachUserToE2EOrg(user.email);
  return user;
}

/** Log in through the dashboard login form UI. */
export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('/');
}

/** Create an org-attached user and log them in. Returns the credentials. */
export async function createAndLoginUser(
  page: Page,
  request: APIRequestContext,
  prefix = 'E2E Operator',
): Promise<TestUser> {
  const user = makeUser(prefix);
  await createOrgUser(request, user);
  await loginAs(page, user.email, user.password);
  return user;
}

/** Authenticated API mutation through the dashboard rewrite (cookies flow). */
export async function apiMutation(
  request: APIRequestContext,
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  data?: unknown,
) {
  return request.fetch(path, {
    method,
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': randomUUID(),
    },
    data: data ?? {},
  });
}

export async function apiGet(request: APIRequestContext, path: string) {
  return request.get(path, { headers: { accept: 'application/json' } });
}
