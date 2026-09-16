import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import FansPage from './page';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({ api: { models: { fans: vi.fn(), customRequests: vi.fn() } } }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.models.fans).mockResolvedValue({ data: [{ id: 'fan', displayName: 'Saved contact', platform: 'fanvue', tier: 'new', lifetimeValueUsd: '12' }] } as Awaited<ReturnType<typeof api.models.fans>>);
  vi.mocked(api.models.customRequests).mockResolvedValue({ data: [{ id: 'request', title: 'Saved request', status: 'pending', priceUsd: '20' }] } as Awaited<ReturnType<typeof api.models.customRequests>>);
});
const render = async () => renderToStaticMarkup(await FansPage({ params: Promise.resolve({ id: 'talent' }) }));

describe('independent fan section loading', () => {
  it('preserves contacts when custom requests fail', async () => {
    vi.mocked(api.models.customRequests).mockRejectedValue(new Error('Unavailable'));
    const html = await render();
    expect(html).toContain('Saved contact');
    expect(html).toContain('Custom requests could not be loaded');
    expect(html).not.toContain('No custom request tickets');
  });
  it('preserves requests when contacts fail', async () => {
    vi.mocked(api.models.fans).mockRejectedValue(new Error('Unavailable'));
    const html = await render();
    expect(html).toContain('Saved request');
    expect(html).toContain('Fan contacts could not be loaded');
    expect(html).not.toContain('No fan contacts yet');
  });
  it('shows empty states only for successful empty responses', async () => {
    vi.mocked(api.models.fans).mockResolvedValue({ data: [] } as Awaited<ReturnType<typeof api.models.fans>>);
    vi.mocked(api.models.customRequests).mockResolvedValue({ data: [] } as Awaited<ReturnType<typeof api.models.customRequests>>);
    const html = await render();
    expect(html).toContain('No fan contacts yet');
    expect(html).toContain('No custom request tickets');
    expect(html).not.toContain('role="alert"');
  });
});
