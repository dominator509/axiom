// ─── Dashboard: first load widgets, seeded lists, section navigation ────────

import { test, expect } from '@playwright/test';
import { createAndLoginUser } from './helpers';

test.describe('dashboard', () => {
  test.beforeEach(async ({ page, request }) => {
    await createAndLoginUser(page, request, 'Dashboard');
  });

  test('first load renders the portfolio widgets', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Your talent, beautifully organized.' }),
    ).toBeVisible();
    await expect(page.getByText('Total talent')).toBeVisible();
    await expect(page.getByText('Active now')).toBeVisible();
    await expect(page.getByText('Studio status')).toBeVisible();
    await expect(page.getByText('private systems connected')).toBeVisible();
  });

  test('talent list renders the seeded rows', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Talent profiles' })).toBeVisible();
    await expect(page.getByText('Seeded Star')).toBeVisible();
    await expect(page.getByText('@seeded.star')).toBeVisible();
    await expect(page.getByText('Fixture Muse')).toBeVisible();
    await expect(page.getByText('@fixture.muse')).toBeVisible();
  });

  test('navigates between the main sections', async ({ page }) => {
    await page.getByRole('link', { name: 'Audit trail' }).click();
    await expect(page.getByRole('heading', { name: 'Trust & activity' })).toBeVisible();
    // The audit table renders with its column headers.
    await expect(page.getByRole('columnheader', { name: 'Action' })).toBeVisible();

    await page.getByRole('link', { name: 'Incidents' }).click();
    await expect(page.getByRole('heading', { name: 'Incidents & recovery' })).toBeVisible();

    await page.getByRole('link', { name: 'Safety' }).click();
    await expect(page.getByRole('heading', { name: 'Publishing safety' })).toBeVisible();

    await page.getByRole('link', { name: 'Talent' }).click();
    await expect(
      page.getByRole('heading', { name: 'Your talent, beautifully organized.' }),
    ).toBeVisible();
  });

  test('model card opens the talent workspace', async ({ page }) => {
    await page.getByText('Seeded Star').click();

    await expect(page).toHaveURL(/\/models\/[0-9a-f-]+/);
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
    // The handle renders in both the workspace header and the profile card;
    // scope to the header to avoid a strict-mode ambiguity.
    await expect(page.locator('.talent-header').getByText('@seeded.star')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Network & security' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
    // Workspace tabs render.
    await expect(page.getByRole('link', { name: 'Fan CRM' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Analytics' })).toBeVisible();
  });
});
