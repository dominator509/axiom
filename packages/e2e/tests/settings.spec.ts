// ─── Settings: killswitch toggle (UI) + org-settings patch (API) ─────────────
// The dashboard's settings surface is the Publishing safety page, which flips
// the kill switch persisted to org_settings; the org-settings endpoint itself
// is exercised through the authenticated API with the required
// Idempotency-Key, verifying persistence with a follow-up GET.

import { test, expect } from '@playwright/test';
import { createAndLoginUser, apiMutation, apiGet } from './helpers';

test.describe('publishing safety (kill switch)', () => {
  test('engaging and restoring persists across reloads', async ({ page, request }) => {
    await createAndLoginUser(page, request, 'Killswitch');

    await page.goto('/killswitch');
    await expect(page.getByRole('heading', { name: 'Publishing safety' })).toBeVisible();

    // Start from a known state: restore if a previous run left it engaged.
    const engageButton = page.getByRole('button', { name: 'ENGAGE KILL SWITCH' });
    const restoreButton = page.getByRole('button', { name: 'Restore publishing' });
    await expect(engageButton.or(restoreButton)).toBeVisible();
    if (await restoreButton.isVisible()) {
      await restoreButton.click();
      await expect(engageButton).toBeVisible();
    }

    const reason = `E2E drill ${Date.now()}`;
    await page.getByLabel(/Reason \(recorded in audit\)/).fill(reason);
    await page.getByRole('button', { name: 'ENGAGE KILL SWITCH' }).click();

    await expect(page.getByText('HALTED')).toBeVisible();
    await expect(page.getByText(reason)).toBeVisible();

    await page.reload();
    await expect(page.getByText('HALTED')).toBeVisible();
    await expect(page.getByText(reason)).toBeVisible();

    await page.getByRole('button', { name: 'Restore publishing' }).click();
    await expect(page.getByText('enabled', { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText('enabled', { exact: true })).toBeVisible();
    await expect(page.getByText('HALTED')).toBeHidden();
  });
});

test.describe('org settings', () => {
  test('patching a setting persists and reads back', async ({ page, request }) => {
    await createAndLoginUser(page, request, 'Org Settings');

    const patchRes = await apiMutation(page.request, 'PATCH', '/api/v1/org-settings', {
      viralSharing: true,
    });
    expect(patchRes.status()).toBe(200);
    expect(
      ((await patchRes.json()) as { data: { viralSharing: boolean } }).data.viralSharing,
    ).toBe(true);

    const getRes = await apiGet(page.request, '/api/v1/org-settings');
    expect(getRes.status()).toBe(200);
    expect(((await getRes.json()) as { data: { viralSharing: boolean } }).data.viralSharing).toBe(
      true,
    );

    const revertRes = await apiMutation(page.request, 'PATCH', '/api/v1/org-settings', {
      viralSharing: false,
    });
    expect(revertRes.status()).toBe(200);

    const getAgain = await apiGet(page.request, '/api/v1/org-settings');
    expect(
      ((await getAgain.json()) as { data: { viralSharing: boolean } }).data.viralSharing,
    ).toBe(false);
  });

  test('an empty patch body is rejected', async ({ page, request }) => {
    await createAndLoginUser(page, request, 'Org Settings Validation');

    const res = await apiMutation(page.request, 'PATCH', '/api/v1/org-settings', {});
    expect(res.status()).toBe(400);
  });
});
