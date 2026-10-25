import { expect, it, vi } from 'vitest';
import { scopeVeniceCacheControl } from '@axiom/llm-gateway';
import { loadCacheControls } from './load-cache-controls.js';

it('loads tenant-scoped Venice affinity and keeps absent/disabled settings inert', async () => {
  const setting = { provider: 'venice', enabled: true, prefixAlignment: false, promptCacheKey: 'model:v1' };
  const where = vi.fn().mockResolvedValue([setting]);
  const tx = { select: () => ({ from: () => ({ where }) }) } as unknown as Parameters<typeof loadCacheControls>[0];
  const a = (await loadCacheControls(tx, 'org-a', 'model-a')).find(row => row.provider === 'venice');
  expect(a).toEqual(scopeVeniceCacheControl(setting, 'org-a', 'model-a'));
  expect((await loadCacheControls(tx, 'org-b', 'model-a')).find(row => row.provider === 'venice')).not.toEqual(a);
  expect((await loadCacheControls(tx, 'org-a', 'model-b')).find(row => row.provider === 'venice')).not.toEqual(a);
  where.mockResolvedValue([{ ...setting, enabled: false }]);
  expect((await loadCacheControls(tx, 'org-a', 'model-a')).find(row => row.provider === 'venice')).toMatchObject({ enabled: false });
  where.mockResolvedValue([]);
  expect((await loadCacheControls(tx, 'org-a', 'model-a')).find(row => row.provider === 'venice')).toEqual({ provider: 'venice', enabled: false, prefixAlignment: false, promptCacheKey: null });
});
