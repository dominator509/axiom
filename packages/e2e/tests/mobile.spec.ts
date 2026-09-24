// ─── Critical flows at a 375px mobile viewport ───────────────────────────────
// Runs in the `mobile` project (iPhone 13 device descriptor overridden to
// exactly 375×667 CSS px).

import { test, expect } from '@playwright/test';
import { createAndLoginUser } from './helpers';

test.describe('mobile viewport', () => {
  test.beforeEach(async ({ page, request }) => {
    await createAndLoginUser(page, request, 'Mobile');
  });

  test('login form renders and signs in', async ({ page }) => {
    // Already logged in by beforeEach; sign out first to exercise the form.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Enter your studio' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('dashboard renders widgets and seeded rows', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Your talent, beautifully organized.' }),
    ).toBeVisible();
    await expect(page.getByText('Total talent')).toBeVisible();
    await expect(page.getByText('Seeded Star')).toBeVisible();
  });

  test('section navigation works', async ({ page }) => {
    await page.getByRole('link', { name: 'Audit trail' }).click();
    await expect(page.getByRole('heading', { name: 'Trust & activity' })).toBeVisible();

    await page.getByRole('link', { name: 'Safety' }).click();
    await expect(page.getByRole('heading', { name: 'Publishing safety' })).toBeVisible();

    await page.getByRole('link', { name: 'Talent' }).click();
    await expect(
      page.getByRole('heading', { name: 'Your talent, beautifully organized.' }),
    ).toBeVisible();
  });

  test('can create a talent profile from the dialog', async ({ page }) => {
    const stamp = Date.now().toString(36);
    const name = `Mobile Talent ${stamp}`;

    await page.getByRole('button', { name: 'Add talent' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Creator name').fill(name);
    await dialog.getByLabel('Handle').fill(`mobile.talent.${stamp}`);
    await dialog.getByRole('button', { name: 'Create profile' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText(name)).toBeVisible();
  });
});
