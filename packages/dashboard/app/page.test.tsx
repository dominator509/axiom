import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import HomePage from './page';

const getServerLocale = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [] }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/server-locale', () => ({ getServerLocale }));
afterEach(() => vi.unstubAllGlobals());

const messages: Record<string, string> = {
  'home.eyebrow': 'Portfolio',
  'home.title': 'Your talent, beautifully organized.',
  'home.intro': 'Create, grow, and protect every creator brand from one private command center.',
  'home.gettingStarted': 'What would you like to do?',
  'home.gettingStartedDescription': 'Start with a talent profile below. Create content, review the saved media, then choose a publishing time in its workspace. Creating content does not publish it.',
  'home.setupGrok': 'Set up Grok & media storage',
  'home.chooseTalent': 'Choose a talent profile',
  'home.portfolioSummary': 'Portfolio summary',
  'home.totalTalent': 'Total talent',
  'home.countUnavailable': 'Profile count could not be loaded',
  'home.profilesInStudio': 'profiles in your studio',
  'home.activeOnPage': 'Active on this page',
  'home.profilesMarkedActive': 'profiles marked active',
  'home.profileList': 'Profile list',
  'home.unavailable': 'Unavailable',
  'home.loaded': 'Loaded',
  'home.profileRequestFailed': 'Profile request failed',
  'home.workspaceUnreachable': 'We could not reach your workspace.',
  'home.noMoreProfiles': 'No more profiles on this page.',
  'home.noProfilesYet': 'No talent profiles yet.',
  'home.returnFirstPage': 'Return to the first page to view your roster.',
  'home.createFirstProfile': 'Create your first talent profile to begin.',
  'home.roster': 'Your roster',
  'home.talentProfiles': 'Talent profiles',
  'home.active': 'Active',
  'home.inactive': 'Inactive',
  'home.freshProfile': 'A fresh creator profile ready to define.',
  'home.openWorkspace': 'Open workspace',
  'home.generateMedia': 'Generate image or video',
  'home.reviewContent': 'Review content',
  'home.talentPagination': 'Talent pagination',
  'home.firstPage': 'First page',
  'home.nextPage': 'Next page',
};

vi.mocked(getServerLocale).mockResolvedValue({
  t: (key: string, values?: Record<string, string | number>) => {
    if (key === 'home.profilesShown') return `${values?.count ?? 0} profiles shown`;
    if (key === 'home.shown') return `${values?.count ?? 0} shown`;
    return messages[key] ?? key;
  },
});

function transport({ empty = false, countFailure = false, pageFailure = false } = {}) {
  const fetch = vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/stats/count')) {
      return new Response(JSON.stringify({ data: { count: 101 } }), { status: countFailure ? 503 : 200 });
    }
    return new Response(JSON.stringify({
      data: empty ? [] : [{ id: 'profile', displayName: 'Visible creator', handle: 'creator', isActive: true }],
      meta: { total: empty ? 0 : 1, limit: 50, next_cursor: empty ? null : 'opaque+/=&cursor' },
    }), { status: pageFailure ? 503 : 200 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function render(query: Record<string, string | string[] | undefined> = {}) {
  return renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve(query) }));
}

describe('portfolio pagination and counts', () => {
  it('offers setup guidance even before a talent profile exists', async () => {
    transport({ empty: true });
    const html = await render();
    expect(html).toContain('What would you like to do?');
    expect(html).toContain('href="/connections/grok"');
    expect(html).toContain('href="#talent-profiles"');
    expect(html).toContain('id="talent-profiles"');
    expect(html).toContain('Creating content does not publish it.');
  });
  it('exposes generation and review directly on each profile without nesting links', async () => {
    transport();
    const html = await render();
    expect(html).toContain('href="/models/profile/generation"');
    expect(html).toContain('Generate image or video');
    expect(html).toContain('href="/models/profile/approvals"');
    expect(html).toContain('Review content');
    expect(html).not.toMatch(/<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<a\b/);
  });
  it('renders the organization count separately from page counts and an encoded next link', async () => {
    const fetch = transport();
    const html = await render();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(html).toContain('<strong>101</strong>');
    expect(html).toContain('1 profiles shown');
    expect(html).toContain('Active on this page');
    expect(html).toContain('cursor=opaque%2B%2F%3D%26cursor');
    expect(html).not.toContain('ready for publishing');
    expect(html).not.toContain('private systems connected');
  });

  it('round-trips the cursor and offers reset on an exhausted page', async () => {
    const fetch = transport({ empty: true });
    const cursor = 'opaque+/=&cursor';
    const html = await render({ cursor });
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('cursor')).toBe(cursor);
    expect(html).toContain('No more profiles on this page');
    expect(html).toContain('First page');
    expect(html).not.toContain('Create your first talent');
    expect(html).not.toContain('Next page');
  });

  it('rejects ambiguous repeated cursor values by returning to the first page', async () => {
    const fetch = transport();
    await render({ cursor: ['first', 'second'] });
    expect(new URL(fetch.mock.calls[0][0]).searchParams.has('cursor')).toBe(false);
  });

  it('preserves profiles when only the aggregate count fails', async () => {
    transport({ countFailure: true });
    const html = await render();
    expect(html).toContain('Visible creator');
    expect(html).toContain('Profile count could not be loaded');
    expect(html).not.toContain('<strong>0</strong>');
  });

  it('shows a failed page without pretending the studio is empty', async () => {
    transport({ pageFailure: true });
    const html = await render({ cursor: 'invalid' });
    expect(html).toContain('Profile request failed');
    expect(html).toContain('First page');
    expect(html).not.toContain('No talent profiles yet');
    expect(html).not.toContain('Next page');
  });
});
