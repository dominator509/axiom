import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LocaleProvider from './LocaleProvider';
import ScrapeRunManager from './ScrapeRunManager';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const run = {
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
} as const;

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
