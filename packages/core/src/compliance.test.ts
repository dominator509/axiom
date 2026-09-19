import { describe, expect, it } from 'vitest';
import { tosReportPassesForPlatforms } from './compliance.js';

describe('tosReportPassesForPlatforms', () => {
  it('requires a passing score for every requested platform', () => {
    const report = {
      verdict: 'pass',
      scores: [
        { platform: 'instagram', verdict: 'pass' },
        { platform: 'x', verdict: 'pass' },
      ],
    };

    expect(tosReportPassesForPlatforms(report, ['instagram', 'x'])).toBe(true);
    expect(tosReportPassesForPlatforms(report, ['instagram', 'tiktok'])).toBe(false);
  });

  it('rejects missing, non-passing, malformed, and duplicate scores', () => {
    expect(tosReportPassesForPlatforms(null, ['instagram'])).toBe(false);
    expect(tosReportPassesForPlatforms({ verdict: 'review', scores: [] }, ['instagram'])).toBe(
      false,
    );
    expect(
      tosReportPassesForPlatforms(
        { verdict: 'pass', scores: [{ platform: 'instagram', verdict: 'review' }] },
        ['instagram'],
      ),
    ).toBe(false);
    expect(
      tosReportPassesForPlatforms(
        {
          verdict: 'pass',
          scores: [
            { platform: 'instagram', verdict: 'pass' },
            { platform: 'instagram', verdict: 'pass' },
          ],
        },
        ['instagram'],
      ),
    ).toBe(false);
  });
});
