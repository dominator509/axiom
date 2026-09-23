import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ScrapeRun } from '@/lib/api';
import type { ScrapeCompetitorBenchmark } from '@/lib/api';
import LocaleProvider from './LocaleProvider';
import ScrapeRunManager from './ScrapeRunManager';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const run: ScrapeRun = {
  id: 'run-1',
  modelId: 'model-1',
  kind: 'social',
  state: 'completed',
  error: null,
  createdAt: '2026-09-18T12:00:00.000Z',
  completedAt: '2026-09-18T12:34:00.000Z',
  result: {
    kind: 'social',
    state: 'completed',
    profiles: [{ platform: 'instagram', displayName: 'Creator', profileUrl: null, bio: null, followers: 1234, following: null, posts: null, items: [], error: null }],
    observedProfiles: 1234,
    failedProfiles: 0,
    totalItems: 0,
    missingCount: null,
  },
};

it('localizes scraper controls, state labels, counts, and timestamps together', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="de">
      <ScrapeRunManager modelId="model-1" runs={[run]} canEdit cursor="older" nextCursor="next" />
    </LocaleProvider>,
  );
  expect(html).toContain('Recherche starten');
  expect(html).toContain('Recherche einreihen');
  expect(html).toContain('Recherche abgeschlossen');
  expect(html).toContain('Beobachtete Profile: 1.234');
  expect(html).toContain('18.');
  expect(html).toContain('Neueste Recherche');
  expect(html).toContain('Ältere Recherchen');
  expect(html).not.toContain('Queue scrape');
  expect(html).not.toContain('Finished ');
});

it('keeps history visible while withholding mutation controls from read-only users', () => {
  const html = renderToStaticMarkup(<ScrapeRunManager modelId="model-1" runs={[run]} canEdit={false} />);
  expect(html).toContain('Social profile research');
  expect(html).toContain('Completed research');
  expect(html).not.toContain('Start a research run');
  expect(html).not.toContain('Queue scrape');
});

it('shows localized repeated competitor observations without inventing missing counts', () => {
  const benchmark: ScrapeCompetitorBenchmark[] = [{
    platform: 'instagram', displayName: 'Creator', profileUrl: 'https://example.com/creator',
    observations: 2, lastObservedAt: '2026-09-03T00:00:00.000Z', followers: 130,
    followerChange: 30, followerChangePerDay: 15, posts: 204, postChange: 4,
    postsPerDay: 2, measuredDays: 2,
    history: [
      { observedAt: '2026-09-01T00:00:00.000Z', followers: 100, posts: 200 },
      { observedAt: '2026-09-03T00:00:00.000Z', followers: 130, posts: null },
    ],
  }];
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="de">
      <ScrapeRunManager modelId="model-1" runs={[]} benchmark={benchmark} canEdit={false} />
    </LocaleProvider>,
  );
  expect(html).toContain('Verlauf (2)');
  expect(html).toContain('Beobachtet');
  expect(html).toContain('100');
  expect(html).toContain('200');
  expect(html).toContain('Nicht verfügbar');
  expect(html).not.toContain('History (2)');
});
