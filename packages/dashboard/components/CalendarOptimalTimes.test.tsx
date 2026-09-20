import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CalendarOptimalTimes, { deriveCalendarTimeSuggestions } from './CalendarOptimalTimes';

vi.mock('./LocaleProvider', () => ({ useLocale: () => ({
  locale: 'en',
  t: (key: string, values?: Record<string, string | number>) => ({
    'calendar.timeWindow.1': '06:00–11:59 UTC',
    'calendar.timeWindow.3': '18:00–23:59 UTC',
    'calendar.observedSuggestionsAria': 'Observed calendar time suggestions',
    'calendar.observedTimeSuggestions': 'Observed time suggestions',
    'calendar.advisoryWindows': 'These are advisory windows from verified published exemplars. They do not schedule, publish, or imply causal lift.',
    'calendar.noVerifiedWindow': 'No verified time window is strong enough to suggest yet.',
    'calendar.verifiedExemplarsScore': `${values?.sampleSize ?? 0} verified exemplars · mean relative score ${values?.score ?? ''}`,
    'calendar.reviewEvidence': 'Review the evidence behind these windows',
  }[key] ?? key),
}) }));

const groups = [
  { platform: 'x', arm: 'short:question', context: 'learn-v1:scheduled-utc-3', sampleSize: 9, meanScore: 1.2 },
  { platform: 'instagram', arm: 'medium:statement', context: 'learn-v1:scheduled-utc-1', sampleSize: 12, meanScore: 2.1 },
  { platform: 'x', arm: 'long:statement', context: 'learn-v1:scheduled-utc-unknown', sampleSize: 50, meanScore: 99 },
];

describe('calendar observed time suggestions', () => {
  it('keeps only verified time buckets and sorts by observed score', () => {
    expect(deriveCalendarTimeSuggestions({ groups, minimumSample: 3 })).toEqual([
      { platform: 'instagram', window: '06:00–11:59 UTC', sampleSize: 12, meanScore: 2.1 },
      { platform: 'x', window: '18:00–23:59 UTC', sampleSize: 9, meanScore: 1.2 },
    ]);
  });

  it('labels suggestions as advisory and does not imply scheduling', () => {
    const html = renderToStaticMarkup(<CalendarOptimalTimes modelId="model" patterns={{ groups, minimumSample: 3 }} />);
    expect(html).toContain('Observed time suggestions');
    expect(html).toContain('advisory');
    expect(html).toContain('do not schedule');
    expect(html).toContain('/models/model/analytics');
  });
  it('treats learn-v2 as the same bounded UTC window for display', () => {
    expect(deriveCalendarTimeSuggestions({ groups: [{ ...groups[0], context: 'learn-v2:scheduled-utc-3' }], minimumSample: 3 })).toEqual([
      { platform: 'x', window: '18:00–23:59 UTC', sampleSize: 9, meanScore: 1.2 },
    ]);
  });
});
