import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const mocks = vi.hoisted(() => ({
  role: 'model',
  analytics: vi.fn(),
  viral: vi.fn(),
  playbookGuidelines: vi.fn(),
  uiLocale: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  getSession: async () => ({ user: { role: mocks.role } }),
  api: {
    models: {
      analytics: mocks.analytics,
      viral: mocks.viral,
      playbookGuidelines: mocks.playbookGuidelines,
    },
    uiLocale: { get: mocks.uiLocale },
  },
}));
import Page from './page';
beforeEach(() => {
  mocks.role = 'model';
  mocks.analytics.mockReset();
  mocks.viral.mockReset();
  mocks.playbookGuidelines.mockReset();
  mocks.uiLocale.mockReset().mockResolvedValue({ data: { locale: 'en' } });
});
it.each(['model', 'content_creator'])(
  'keeps all assigned analytics destinations for %s',
  async (role) => {
    mocks.role = role;
    mocks.analytics.mockResolvedValue({
      data: {
        totals: { views: 10, likes: 2, shares: 0, comments: 1 },
        windowDays: 30,
        perPlatform: [],
        daily: [],
      },
    });
    mocks.viral.mockResolvedValue({ data: { totalExemplars: 0 } });
    mocks.playbookGuidelines.mockResolvedValue({
      data: [
        {
          id: 'guideline-1',
          modelId: 'assigned',
          platform: 'instagram',
          optimalTimes: ['18:00'],
          cadencePerWeek: 3,
          upsellStrategy: 'Approved approach',
          revision: 4,
          updatedAt: '2030-01-01T00:00:00.000Z',
        },
      ],
    });
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'assigned' }) }));
    expect(mocks.analytics).toHaveBeenCalledWith('assigned', 30);
    expect(mocks.viral).toHaveBeenCalledWith('assigned');
    expect(mocks.playbookGuidelines).toHaveBeenCalledWith('assigned');
    expect(html).toContain('/api/v1/models/assigned/reports/monthly');
    expect(html).toContain('No verified published exemplars yet');
    expect(html).toContain('relative engagement, not conversions');
    expect(html).toContain('Playbook guidance context');
    expect(html).toContain('instagram · revision 4');
    expect(html).toContain('Cadence target: 3 posts/week.');
    expect(html).toContain('Approved approach');
  },
);
it('fails closed when playbook context is unavailable without hiding analytics', async () => {
  mocks.analytics.mockResolvedValue({
    data: {
      totals: { views: 10, likes: 2, shares: 0, comments: 1 },
      windowDays: 30,
      perPlatform: [],
      daily: [],
    },
  });
  mocks.viral.mockResolvedValue({ data: { totalExemplars: 0 } });
  mocks.playbookGuidelines.mockRejectedValue(new Error('unavailable'));
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'assigned' }) }));
  expect(html).toContain('Playbook guidance could not be loaded');
  expect(html).toContain('10');
});
it('renders localized labels and locale-aware metrics', async () => {
  mocks.uiLocale.mockResolvedValue({ data: { locale: 'es' } });
  mocks.analytics.mockResolvedValue({
    data: {
      totals: { views: 12345, likes: 2, shares: 0, comments: 1 },
      windowDays: 30,
      perPlatform: [
        {
          platform: 'instagram',
          views: 12345,
          likes: 2,
          shares: 0,
          comments: 1,
          engagementRate: 0.125,
        },
      ],
      daily: [{ day: '2026-09-15', views: 12345, likes: 2 }],
    },
  });
  mocks.viral.mockResolvedValue({ data: { totalExemplars: 0 } });
  mocks.playbookGuidelines.mockResolvedValue({ data: [] });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'assigned' }) }));
  expect(html).toContain('Rendimiento');
  expect(html).toContain('Descargar PDF mensual');
  expect(html).toContain('Por plataforma');
  expect(html).toContain('12.345');
  expect(html).toContain(
    new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date('2026-09-15T00:00:00Z'),
    ),
  );
  expect(html).not.toContain('2026-09-15');
  expect(html).toContain('últimos 30 días');
});
it.each(['chatter', 'unknown'])('does not request analytics for %s', async (role) => {
  mocks.role = role;
  expect(
    renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'assigned' }) })),
  ).toContain('Analytics access unavailable');
  expect(mocks.analytics).not.toHaveBeenCalled();
  expect(mocks.viral).not.toHaveBeenCalled();
  expect(mocks.playbookGuidelines).not.toHaveBeenCalled();
});
