import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ModelOverviewPage from './page';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({ api: { models: {
  get: vi.fn(), network: vi.fn(), calendar: vi.fn(), fans: vi.fn(),
} } }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.models.get).mockResolvedValue({ data: {
    id: 'talent', handle: 'creator', bio: 'Profile', createdAt: '2026-09-15',
  } } as Awaited<ReturnType<typeof api.models.get>>);
  vi.mocked(api.models.network).mockRejectedValue(new Error('Unavailable'));
  vi.mocked(api.models.calendar).mockResolvedValue({ data: [] } as Awaited<ReturnType<typeof api.models.calendar>>);
  vi.mocked(api.models.fans).mockResolvedValue({ data: [] } as Awaited<ReturnType<typeof api.models.fans>>);
});

const render = async () => renderToStaticMarkup(await ModelOverviewPage({ params: Promise.resolve({ id: 'talent' }) }));

describe('talent overview recovery and navigation', () => {
  it('links summaries and next actions to this talent workspace', async () => {
    const html = await render();
    for (const route of ['network', 'calendar', 'fans', 'generation', 'approvals']) {
      expect(html).toContain(`href="/models/talent/${route}"`);
    }
  });
  it('keeps legitimate empty counts without inventing network configuration state', async () => {
    const html = await render();
    expect(html.match(/<strong>0<\/strong>/g)).toHaveLength(2);
    expect(html).toContain('Network status could not be loaded.');
    expect(html).not.toContain('No network configuration yet.');
  });
  it('never presents failed count requests as zero activity', async () => {
    vi.mocked(api.models.calendar).mockRejectedValue(new Error('Unavailable'));
    vi.mocked(api.models.fans).mockRejectedValue(new Error('Unavailable'));
    const html = await render();
    expect(html.match(/<strong>Unavailable<\/strong>/g)).toHaveLength(2);
    expect(html).not.toContain('<strong>0</strong>');
  });
  it('offers a way back without falsely claiming a missing profile on a request failure', async () => {
    vi.mocked(api.models.get).mockRejectedValue(new Error('Unavailable'));
    const html = await render();
    expect(html).toContain('role="alert"');
    expect(html).toContain('href="/"');
    expect(html).not.toContain('Model not found');
  });
});
