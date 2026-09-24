import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const list = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() => vi.fn());
const locale = vi.hoisted(() => ({ value: 'en' }));
vi.mock('@/lib/api', () => ({ api: { models: { scrapeRuns: list } }, getSession }));
vi.mock('@/lib/server-locale', () => ({
  getServerLocale: async () => ({
    locale: locale.value,
    t: (key: string) => `${locale.value}:${key}`,
    dateTime: (value: string | Date) => String(value),
  }),
}));

import ScrapingPage from './page';
vi.mock('@/components/ScrapeRunManager', () => ({
  default: ({ cursor, nextCursor }: { cursor?: string; nextCursor?: string | null }) => <div>{cursor ?? 'first'}:{nextCursor ?? 'done'}</div>,
}));

beforeEach(() => {
  list.mockReset();
  getSession.mockResolvedValue({ user: { role: 'operator' } });
  locale.value = 'en';
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
  expect(html).toContain('en:scrape.unavailable');
  expect(html).toContain('en:scrape.loadFailed');
});

it('uses the persisted locale for route-level title and failure copy', async () => {
  locale.value = 'de';
  list.mockRejectedValue(new Error('unavailable'));
  const html = renderToStaticMarkup(await ScrapingPage({ params: Promise.resolve({ id: 'talent' }) }));
  expect(html).toContain('de:scrape.unavailable');
  expect(html).toContain('de:scrape.loadFailed');
});
