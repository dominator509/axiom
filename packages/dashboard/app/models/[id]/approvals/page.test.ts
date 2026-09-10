import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ApprovalsPage from './page';

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [] }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => vi.unstubAllGlobals());

function transport(state: string, verdict = 'pass', failHeld = false) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const requestedState = url.searchParams.get('state');
    if (url.pathname === '/api/v1/social-accounts') {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: 'connected-instagram-account',
              platform: 'instagram',
              status: 'connected',
              displayName: 'Review account',
            },
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
    if (failHeld && requestedState === 'hold') {
      return new Response('Held review queue unavailable', { status: 503 });
    }
    const data =
      requestedState === state
        ? [
            {
              id: '11111111-1111-4111-8111-111111111111',
              modelId: 'model-under-review',
              state,
              captions: { instagram: 'Caption awaiting operator review' },
              hashtags: [],
              tosReport: { verdict },
              createdAt: '2026-01-01T00:00:00Z',
            },
          ]
        : [];
    return new Response(JSON.stringify({ data }), {
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function renderPage() {
  return renderToStaticMarkup(
    await ApprovalsPage({ params: Promise.resolve({ id: 'model-under-review' }) }),
  );
}

describe('approval review queue', () => {
  it.each(['hold', 'generated'])('renders %s bundles with review controls', async (state) => {
    const fetchMock = transport(state);
    const html = await renderPage();
    expect(html).toContain('Caption awaiting operator review');
    expect(html).toContain('Revise captions');
    expect(html).toContain('Reject');
    const approveButton = html.match(/<button[^>]*>Approve<\/button>/)?.[0];
    expect(approveButton).toBeDefined();
    expect(approveButton).not.toContain('disabled');
    expect(html).not.toContain('No bundles awaiting review');
    const queries = fetchMock.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname === '/api/v1/bundles');
    expect(queries.map((url) => url.searchParams.get('state')).sort()).toEqual([
      'generated',
      'hold',
      'revising',
    ]);
    expect(queries.every((url) => url.searchParams.get('modelId') === 'model-under-review')).toBe(
      true,
    );
  });

  it('keeps held bundles visible without bypassing ToS approval restrictions', async () => {
    transport('hold', 'block');
    const html = await renderPage();
    expect(html).toContain('ToS: block');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Blocked by ToS<\/button>/);
    expect(html).toContain('Revise captions');
  });

  it('shows in-progress revision status instead of actionable approval controls', async () => {
    transport('revising', 'pending');
    const html = await renderPage();
    expect(html).toContain('Caption revision pending');
    expect(html).not.toContain('Revise captions');
  });

  it('reports held-queue failure instead of claiming an empty review queue', async () => {
    transport('hold', 'pass', true);
    const html = await renderPage();
    expect(html).toContain('Held review queue unavailable');
    expect(html).not.toContain('No bundles awaiting review');
  });
});
