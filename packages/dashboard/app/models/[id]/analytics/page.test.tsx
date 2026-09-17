import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const mocks = vi.hoisted(() => ({ role: 'model', analytics: vi.fn(), viral: vi.fn() }));
vi.mock('@/lib/api', () => ({ getSession: async () => ({ user: { role: mocks.role } }), api: { models: { analytics: mocks.analytics, viral: mocks.viral } } }));
import Page from './page';
beforeEach(() => { mocks.role = 'model'; mocks.analytics.mockReset(); mocks.viral.mockReset(); });
it.each(['model', 'content_creator'])('keeps all assigned analytics destinations for %s', async role => {
  mocks.role = role;
  mocks.analytics.mockResolvedValue({ data: { totals: { views: 10, likes: 2, shares: 0, comments: 1 }, windowDays: 30, perPlatform: [], daily: [] } });
  mocks.viral.mockResolvedValue({ data: { totalExemplars: 0 } });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'assigned' }) }));
  expect(mocks.analytics).toHaveBeenCalledWith('assigned', 30); expect(mocks.viral).toHaveBeenCalledWith('assigned');
  expect(html).toContain('/api/v1/models/assigned/reports/monthly');
  expect(html).toContain('No verified published exemplars yet');
  expect(html).toContain('relative engagement, not conversions');
});
it.each(['chatter', 'unknown'])('does not request analytics for %s', async role => {
  mocks.role = role;
  expect(renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'assigned' }) }))).toContain('Analytics access unavailable');
  expect(mocks.analytics).not.toHaveBeenCalled(); expect(mocks.viral).not.toHaveBeenCalled();
});
