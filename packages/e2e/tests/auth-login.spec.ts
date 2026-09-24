// ─── Login / logout / session persistence ────────────────────────────────────

import { test, expect } from '@playwright/test';
import { makeUser, createOrgUser, loginAs } from './helpers';

test.describe('login', () => {
  test('valid credentials land on the dashboard', async ({ page, request }) => {
    const user = makeUser('Login');
    await createOrgUser(request, user);

    await loginAs(page, user.email, user.password);

    await expect(
      page.getByRole('heading', { name: 'Your talent, beautifully organized.' }),
    ).toBeVisible();
  });

  test('bad password shows an error and stays on the login page', async ({ page, request }) => {
    const user = makeUser('Login BadPass');
    await createOrgUser(request, user);

    await page.goto('/login');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill('definitely-wrong-1');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/login/);
    // LoginForm renders the API error message (or its fallback) inside the form.
    await expect(page.locator('form')).toContainText(/sign-in failed|invalid|incorrect/i);
  });

  test('unknown email shows an error and stays on the login page', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(`nobody-${Date.now()}@e2e.axiom.local`);
    await page.getByLabel('Password').fill('some-password-1');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('form')).toContainText(/sign-in failed|invalid|incorrect/i);
  });

  test('unauthenticated visits are redirected to login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Enter your studio' })).toBeVisible();
  });
});

test.describe('logout', () => {
  test('signing out ends the session', async ({ page, request }) => {
    const user = makeUser('Logout');
    await createOrgUser(request, user);
    await loginAs(page, user.email, user.password);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);

    // The session cookie is gone: the dashboard is no longer reachable.
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('session persistence', () => {
  test('reload keeps the session alive', async ({ page, request }) => {
    const user = makeUser('Session');
    await createOrgUser(request, user);
    await loginAs(page, user.email, user.password);

    await page.reload();

    await expect(page).toHaveURL('/');
    await expect(
      page.getByRole('heading', { name: 'Your talent, beautifully organized.' }),
    ).toBeVisible();
  });
});
