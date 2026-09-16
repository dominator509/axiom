import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import FansPage from './page';
import { api, getSession } from '@/lib/api';

vi.mock('@/lib/api', () => ({ getSession: vi.fn(), api: { fans: { get: vi.fn() }, models: { fans: vi.fn(), customRequests: vi.fn() } } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.models.fans).mockResolvedValue({ data: [{ id: 'fan', displayName: 'Saved contact', platform: 'fanvue', tier: 'new', lifetimeValueUsd: '12' }] } as Awaited<ReturnType<typeof api.models.fans>>);
  vi.mocked(api.models.customRequests).mockResolvedValue({ data: [{ id: 'request', title: 'Saved request', status: 'pending', priceUsd: '20' }] } as Awaited<ReturnType<typeof api.models.customRequests>>);
});
const render = async () => renderToStaticMarkup(await FansPage({ params: Promise.resolve({ id: 'talent' }) }));

describe('independent fan section loading', () => {
  it('links contacts to a scoped timeline', async () => {
    expect(await render()).toContain('/models/talent/fans?fan=fan');
  });
  it('renders recorded activity and escapes its text', async () => {
    vi.mocked(api.fans.get).mockResolvedValue({ data: {
      fan: { id: 'fan', modelId: 'talent', displayName: 'Fan', platform: 'x', tier: 'new', lifetimeValueUsd: '0', lastActiveAt: null },
      touchpoints: [{ id: 'point', platform: 'x', kind: 'note', direction: 'inbound', content: '<script>unsafe</script>', ts: '2026-09-15T10:00:00Z' }], requests: [],
    } } as Awaited<ReturnType<typeof api.fans.get>>);
    const html = renderToStaticMarkup(await FansPage({ params: Promise.resolve({ id: 'talent' }), searchParams: Promise.resolve({ fan: '11111111-1111-4111-8111-111111111111' }) }));
    expect(html).toContain('recorded activity');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('100 most recent');
  });
  it('does not render another talent fan details', async () => {
    vi.mocked(api.fans.get).mockResolvedValue({ data: { fan: { modelId: 'other', displayName: 'Other private name' } } } as Awaited<ReturnType<typeof api.fans.get>>);
    const html = renderToStaticMarkup(await FansPage({ params: Promise.resolve({ id: 'talent' }), searchParams: Promise.resolve({ fan: '11111111-1111-4111-8111-111111111111' }) }));
    expect(html).toContain('could not be loaded for this talent');
    expect(html).not.toContain('Other private name');
  });
  it('exposes contact editing to operators', async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: 'user', role: 'operator' } });
    expect(await render()).toContain('Save fan contact');
  });
  it('does not expose contact editing without a permitted role', async () => {
    expect(await render()).not.toContain('Save fan contact');
  });
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
