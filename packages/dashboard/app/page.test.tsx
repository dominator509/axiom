import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import HomePage from './page';

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [] }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());

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
