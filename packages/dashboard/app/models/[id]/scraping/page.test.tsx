import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const list = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: { models: { scrapeRuns: list } }, getSession }));

import ScrapingPage from './page';
vi.mock('@/components/ScrapeRunManager', () => ({
  default: ({ cursor, nextCursor }: { cursor?: string; nextCursor?: string | null }) => <div>{cursor ?? 'first'}:{nextCursor ?? 'done'}</div>,
}));

beforeEach(() => {
  list.mockReset();
  getSession.mockResolvedValue({ user: { role: 'operator' } });
});

it('passes the validated continuation cursor into the scraper history request', async () => {
  list.mockResolvedValue({ data: [], meta: { next_cursor: 'older-token' } });
  const html = renderToStaticMarkup(await ScrapingPage({
    params: Promise.resolve({ id: 'talent' }),
    searchParams: Promise.resolve({ cursor: 'current-token' }),
  }));
  expect(list).toHaveBeenCalledWith('talent', 'current-token');
  expect(html).toContain('current-token:older-token');
});

it('does not disguise a history failure as an empty run list', async () => {
  list.mockRejectedValue(new Error('unavailable'));
  const html = renderToStaticMarkup(await ScrapingPage({ params: Promise.resolve({ id: 'talent' }) }));
  expect(html).toContain('Scraper unavailable');
  expect(html).toContain('No scrape was started');
});
