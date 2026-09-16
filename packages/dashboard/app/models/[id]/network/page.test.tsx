import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { api, getSession } from '@/lib/api';
import NetworkPage from './page';
vi.mock('@/lib/api', () => ({ getSession: vi.fn(), api: { models: { network: vi.fn() }, social: { list: vi.fn() } } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ user: { id: 'user', role: 'owner' } });
  vi.mocked(api.models.network).mockResolvedValue({ data: { modelId: 'model', egressMode: null, healthy: false, lastCheck: null, latencyMs: null, lastEgressIp: null, failCount: 0, lastError: null } });
  vi.mocked(api.social.list).mockResolvedValue({ data: [] });
});
const render = async () => renderToStaticMarkup(await NetworkPage({ params: Promise.resolve({ id: 'model' }) }));
it('lets an owner configure a successfully loaded unconfigured model', async () => {
  const html = await render();
  expect(html).toContain('Not configured');
  expect(html).toContain('Save network config');
});
it.each(['operator', 'manager', 'viewer'])('does not offer owner controls to %s', async role => {
  vi.mocked(getSession).mockResolvedValue({ user: { id: 'user', role } });
  const html = await render();
  expect(api.models.network).not.toHaveBeenCalled();
  expect(html).toContain('Only a workspace owner');
  expect(html).not.toContain('Save network config');
  expect(html).toContain('Connected accounts');
});
it('does not treat load failure as a fresh editable configuration', async () => {
  vi.mocked(api.models.network).mockRejectedValue(new Error('Unavailable'));
  const html = await render();
  expect(html).toContain('Network configuration could not be loaded');
  expect(html).not.toContain('Save network config');
});
it('distinguishes account load failures from successful empty lists', async () => {
  vi.mocked(api.social.list).mockRejectedValue(new Error('Unavailable'));
  const html = await render();
  expect(html).toContain('Connected accounts could not be loaded');
  expect(html).not.toContain('No platform accounts connected.');
});
