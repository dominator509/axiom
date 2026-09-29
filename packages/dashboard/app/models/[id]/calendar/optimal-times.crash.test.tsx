import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CalendarPage from './page';
import LocaleProvider from '@/components/LocaleProvider';

// Render regression for the ops-hub #29 calendar crash (AXIOM #36, digest
// 690433473). The calendar page mounts `CalendarOptimalTimes`, which consumes
// the client `useLocale()` hook. In the real RSC server render a component
// without a `'use client'` directive throws a server-side exception; here we
// render through the client LocaleProvider boundary and require the observed
// time-suggestion section to actually appear when viral patterns are present.
const session = vi.hoisted(() => ({ role: 'operator' }));
vi.mock('@/lib/api', async original => ({
  ...await original<typeof import('@/lib/api')>(),
  getSession: async () => ({ user: { role: session.role } }),
}));
vi.mock('@/lib/server-locale', () => ({
  getServerLocale: async () => ({
    locale: 'en',
    dateTime: () => 'localized calendar time',
    t: (key: string, values?: Record<string, string | number>) => ({
      'calendar.title': 'Content calendar',
      'calendar.unavailable': 'Calendar unavailable',
      'calendar.postsInView': `${values?.count ?? 0} posts in this ${values?.view ?? ''}`,
      'calendar.post': 'post', 'calendar.posts': 'posts',
      'calendar.month': 'month', 'calendar.week': 'week',
      'calendar.utc': 'UTC',
      'calendar.observedSuggestionsAria': 'Observed posting time suggestions',
      'calendar.observedTimeSuggestions': 'Observed best posting times',
      'calendar.advisoryWindows': 'Windows observed from published results.',
      'calendar.noVerifiedWindow': 'No verified posting window yet.',
      'calendar.verifiedExemplarsScore': `${values?.sampleSize ?? 0} published posts, mean score ${values?.score ?? ''}`,
      'calendar.reviewEvidence': 'Review the evidence',
      'calendar.timeWindow.1': '06:00–11:59 UTC',
    }[key] ?? key),
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [] }) }));
afterEach(() => { vi.unstubAllGlobals(); session.role = 'operator'; });

describe('calendar optimal-times render (ops-hub #29)', () => {
  it('renders observed time suggestions from viral patterns without a server exception', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify(
      url.includes('/viral')
        ? { data: { patterns: { groups: [
          { platform: 'instagram', context: 'learn-v1:scheduled-utc-1', sampleSize: 12, meanScore: 0.42 },
        ], minimumSample: 5 } } }
        : { data: [] },
    ), { status: 200, headers: { 'content-type': 'application/json' } })));

    const element = await CalendarPage({
      params: Promise.resolve({ id: 'calendar-model' }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(<LocaleProvider initialLocale="en">{element}</LocaleProvider>);

    expect(html).toContain('Observed time suggestions');
    expect(html).toContain('06:00–11:59 UTC');
    expect(html).toContain('12 verified exemplars');
  });
});
