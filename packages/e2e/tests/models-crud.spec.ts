// ─── Talent profiles: create (UI) → edit → delete (authenticated API) ───────
// The dashboard exposes model creation through the "Add talent" dialog; there
// is no edit/delete UI on main, so update and soft-delete are exercised
// through the same authenticated /api/v1/* path the dashboard uses, with the
// required Idempotency-Key header.

import { test, expect } from '@playwright/test';
import { createAndLoginUser, apiMutation, apiGet } from './helpers';

interface ModelRow {
  id: string;
  displayName: string;
  handle: string;
  bio: string | null;
  isActive: boolean;
}

async function listModels(request: Parameters<typeof apiGet>[0]): Promise<ModelRow[]> {
  const res = await apiGet(request, '/api/v1/models');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { data: ModelRow[] };
  return body.data;
}

test.describe('talent CRUD', () => {
  test('create via UI, edit and delete via API, changes reflected in the UI', async ({
    page,
    request,
  }) => {
    await createAndLoginUser(page, request, 'Talent CRUD');

    const stamp = Date.now().toString(36);
    const name = `E2E Talent ${stamp}`;
    const handle = `e2e.talent.${stamp}`;
    const bio = 'Created by the E2E suite';

    // — create through the dashboard dialog —
    await page.getByRole('button', { name: 'Add talent' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Creator name').fill(name);
    await dialog.getByLabel('Handle').fill(handle);
    await dialog.getByLabel(/Brand note/).fill(bio);
    await dialog.getByRole('button', { name: 'Create profile' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(name)).toBeVisible();
    await expect(page.getByText(`@${handle}`)).toBeVisible();

    const created = (await listModels(page.request)).find((m) => m.handle === handle);
    expect(created).toBeDefined();
    const modelId = created!.id;

    // — edit through the authenticated API —
    const renamed = `E2E Talent Renamed ${stamp}`;
    const patchRes = await apiMutation(page.request, 'PATCH', `/api/v1/models/${modelId}`, {
      displayName: renamed,
      bio: 'Edited by the E2E suite',
    });
    expect(patchRes.status()).toBe(200);

    await page.reload();
    await expect(page.getByText(renamed)).toBeVisible();
    await expect(page.getByText('Edited by the E2E suite')).toBeVisible();

    // — soft-delete through the authenticated API —
    const delRes = await apiMutation(page.request, 'DELETE', `/api/v1/models/${modelId}`);
    expect(delRes.status()).toBe(200);

    const getRes = await apiGet(page.request, `/api/v1/models/${modelId}`);
    expect(getRes.status()).toBe(200);
    expect(((await getRes.json()) as { data: ModelRow }).data.isActive).toBe(false);

    await page.reload();
    const card = page.locator('.model-card', { hasText: renamed });
    await expect(card.getByText('Inactive')).toBeVisible();
  });

  test('creating a model without a name is rejected by validation', async ({ page, request }) => {
    await createAndLoginUser(page, request, 'Talent Validation');

    const res = await apiMutation(page.request, 'POST', '/api/v1/models', {
      displayName: '',
      handle: 'no-name-handle',
    });
    expect(res.status()).toBe(400);

    // The UI form also requires the fields (native required attributes).
    await page.getByRole('button', { name: 'Add talent' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Creator name')).toHaveAttribute('required', '');
    await expect(dialog.getByLabel('Handle')).toHaveAttribute('required', '');
  });
});
