import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CalendarPage from './page';
const session = vi.hoisted(() => ({ role: 'operator' }));
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), getSession: async () => ({ user: { role: session.role } }) }));
vi.mock('@/lib/server-locale', () => ({ getServerLocale: async () => ({
  locale: 'en',
  dateTime: (value: string | Date) => new Date(value).toISOString(),
  t: (key: string, values?: Record<string, string | number>) => ({
    'calendar.accessUnavailable': 'Calendar access unavailable',
    'calendar.accessDescription': 'Your role does not include this calendar.',
    'calendar.back': 'Back to workspace',
    'calendar.title': 'Content calendar',
    'calendar.unavailable': 'Calendar unavailable',
    'calendar.postsInView': `${values?.count ?? 0} ${values?.noun ?? ''} in this ${values?.view ?? ''}`,
    'calendar.post': 'post',
    'calendar.posts': 'posts',
    'calendar.month': 'month',
    'calendar.week': 'week',
    'calendar.navigation': 'Calendar navigation',
    'calendar.previousMonth': 'Previous month',
    'calendar.nextMonth': 'Next month',
    'calendar.currentMonth': 'Current month',
    'calendar.previousWeek': 'Previous week',
    'calendar.weekOf': `Week of ${values?.date ?? ''} (UTC)`,
    'calendar.nextWeek': 'Next week',
    'calendar.currentWeek': 'Current week',
    'calendar.monthView': 'Month view',
    'calendar.weekView': 'Week view',
    'calendar.monthUtc': 'Month (UTC)',
    'calendar.showMonth': 'Show month',
    'calendar.invalidMonth': 'Invalid or repeated month parameter. Showing the current UTC month.',
    'calendar.invalidWeek': 'Invalid week parameter. Showing the current UTC week.',
    'calendar.invalidView': 'Unknown calendar view. Showing the month view.',
    'calendar.creatorProposalBefore': 'To propose a posting time, stage a saved asset from the ',
    'calendar.mediaLibrary': 'media library',
    'calendar.creatorProposalAfter': ' with a schedule request. An operator must approve it before publication.',
    'calendar.loadFailed': 'Calendar data could not be loaded.',
    'calendar.noScheduledPosts': 'No scheduled posts in the window.',
    'calendar.approveGeneratedBundle': 'Approve a generated bundle to schedule.',
    'calendar.approvedPlansAppear': 'Approved posting plans will appear here.',
    'calendar.postDetails': 'Post details',
    'calendar.utc': 'UTC',
    'calendar.notScheduled': 'not scheduled',
    'calendar.reviewDrafts': 'Review drafts',
    'calendar.viewBundlesApprovals': 'View bundles and approvals',
  }[key] ?? key),
}) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [] }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); session.role = 'operator'; });

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
  it('shows a model calendar without restricted guideline or team-note surfaces', async () => {
    session.role = 'model';
    const fetch = transport();
    const html = await render();
    expect(html).toContain('Content calendar');
    expect(html).toContain('2030-02-20');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain('/calendar?');
    expect(html).not.toContain('/playbook');
    expect(html).not.toContain('/approvals');
    expect(html).not.toContain('Internal post notes');
    expect(html).not.toContain('Change schedule or cancel');
  });
  it('guides creators to reviewable scheduling without direct publishing controls', async () => {
    session.role = 'content_creator'; transport();
    const html = await render();
    expect(html).toContain('with a schedule request');
    expect(html).toContain('href="/models/calendar-model/media"');
    expect(html).toContain('Review drafts');
    expect(html).toContain('Internal post notes');
    expect(html).not.toContain('Change schedule or cancel');
  });
  it.each(['chatter', 'unknown'])('does not request calendar resources for %s', async role => {
    session.role = role; const fetch = transport();
    expect(await render()).toContain('Calendar access unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('loads saved model guidelines and compares the complete current UTC week separately from the selected month', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-01T00:30:00Z'));
    const fetch = vi.fn().mockImplementation(async (url: string) => Response.json({ data: url.includes('playbook-guidelines')
      ? [{ id: 'g', platform: 'x', cadencePerWeek: 3, optimalTimes: ['18:00'], revision: 2 }]
      : [{ id: 'p', platform: 'x', state: 'pending', remoteId: null, scheduledFor: '2030-01-01T18:00:00Z' }] }));
    vi.stubGlobal('fetch', fetch);
    const html = await render({ month: '2030-02' });
    expect(html).toContain('Under planned cadence by 2 posts');
    const urls = fetch.mock.calls.map(([url]) => new URL(url));
    expect(urls.some(url => url.pathname === '/api/v1/models/calendar-model/playbook-guidelines')).toBe(true);
    expect(urls.some(url => url.searchParams.get('from') === '2029-12-31T00:00:00.000Z' && url.searchParams.get('to') === '2030-01-06T23:59:59.999Z')).toBe(true);
  });
  it('exposes editing only to operational roles and pending unpublished posts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify({ data: url.includes('playbook-guidelines') ? [] : [
      { id: 'pending', platform: 'x', state: 'pending', scheduledFor: null, remoteId: null },
      { id: 'handoff', platform: 'x', state: 'pending', scheduledFor: null, remoteId: 'remote' },
      { id: 'published', platform: 'x', state: 'published', scheduledFor: null, remoteId: 'remote' },
    ] }))));
    expect((await render()).match(/Change schedule or cancel/g)).toHaveLength(1);
    session.role = 'viewer';
    expect(await render()).not.toContain('Change schedule or cancel');
  });
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
