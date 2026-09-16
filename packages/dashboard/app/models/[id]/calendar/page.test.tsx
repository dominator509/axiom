import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CalendarPage from './page';

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [] }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function render(query: Record<string, string | string[] | undefined> = {}) {
  return renderToStaticMarkup(await CalendarPage({
    params: Promise.resolve({ id: 'calendar-model' }), searchParams: Promise.resolve(query),
  }));
}

function transport(status = 200) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{
    id: 'post', platform: 'telegram', state: 'published', scheduledFor: '2030-02-20T18:30:00Z',
  }] }), { status, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('calendar month navigation', () => {
  it('loads a distant month through the real API client with UTC bounds', async () => {
    const fetch = transport();
    const html = await render({ month: '2030-02' });
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/v1/models/calendar-model/calendar');
    expect(url.searchParams.get('from')).toBe('2030-02-01T00:00:00.000Z');
    expect(url.searchParams.get('to')).toBe('2030-02-28T23:59:59.999Z');
    expect(html).toContain('month=2030-01');
    expect(html).toContain('month=2030-03');
    expect(html).toContain('Current month');
    expect(html).toContain('1 post in this month');
    expect(html).not.toContain('1 scheduled');
    expect(html).toContain('2030-02-20T18:30:00.000Z (UTC)');
  });

  it('handles leap years and year boundaries', async () => {
    const fetch = transport();
    await render({ month: '2028-02' });
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('to')).toBe('2028-02-29T23:59:59.999Z');
    const html = await render({ month: '2030-01' });
    expect(html).toContain('month=2029-12');
  });

  it.each(['2030-13', 'junk', ['2030-01', '2030-02']])('rejects malformed or ambiguous months: %s', async (month) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-06-01T00:30:00Z'));
    const fetch = transport();
    const html = await render({ month });
    expect(html).toContain('Invalid or repeated month parameter');
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('from')).toBe('2030-06-01T00:00:00.000Z');
  });

  it('does not report an empty calendar when the API fails', async () => {
    transport(503);
    const html = await render({ month: '2030-02' });
    expect(html).toContain('Calendar unavailable');
    expect(html).not.toContain('0 posts');
    expect(html).not.toContain('No scheduled posts');
    expect(html).toContain('Next month');
  });
});
