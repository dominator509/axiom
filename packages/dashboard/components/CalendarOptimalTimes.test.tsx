import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CalendarOptimalTimes, { deriveCalendarTimeSuggestions } from './CalendarOptimalTimes';

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
});
