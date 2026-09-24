// ─── Optional read-only production smoke test ────────────────────────────────
// Target: E2E_PROD_BASE_URL (default https://test.fanthynks.com).
//
// This project NEVER writes: no account creation, no mutations, no logins
// that change state. It only checks that public pages load and render.
//
// The whole file is skipped unless BOTH E2E_PROD_TEST_USER and
// E2E_PROD_TEST_PASS are set (CI secrets). A test account is currently being
// sorted out separately; until then these tests stay skipped by design.

import { test, expect } from '@playwright/test';

const PROD_USER = process.env.E2E_PROD_TEST_USER ?? '';
const PROD_PASS = process.env.E2E_PROD_TEST_PASS ?? '';
const hasProdCreds = PROD_USER.length > 0 && PROD_PASS.length > 0;

test.describe('production smoke (read-only)', () => {
  test.skip(!hasProdCreds, 'E2E_PROD_TEST_USER / E2E_PROD_TEST_PASS are not set');

  test('login page loads and renders the sign-in form', async ({ page }) => {
    const res = await page.goto('/login');
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Enter your studio' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('unauthenticated root redirects to the login page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('login page is served over HTTPS', async ({ page }) => {
    await page.goto('/login');
    expect(page.url().startsWith('https://')).toBe(true);
  });
});
