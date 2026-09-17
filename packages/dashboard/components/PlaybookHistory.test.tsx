import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PlaybookHistory, { validGuidelineRevision } from './PlaybookHistory';
const row = { id: 'revision-id', modelId: 'model', platform: 'x', revision: 3, optimalTimes: ['18:00'], cadencePerWeek: 4, upsellStrategy: 'Approved approach', recordedAt: '2030-01-01T00:00:00Z' };
afterEach(() => vi.restoreAllMocks());
it('accepts only matching model/platform and bounded saved values', () => {
  expect(validGuidelineRevision(row, 'model', 'x')).toBe(true);
  for (const changed of [{ modelId: 'other' }, { platform: 'instagram' }, { revision: 0 }, { cadencePerWeek: 101 }, { optimalTimes: [42] }, { recordedAt: 'bad' }])
    expect(validGuidelineRevision({ ...row, ...changed }, 'model', 'x')).toBe(false);
});
it('makes loading explicit and explains that history cannot reconstruct lost values', () => {
  const html = renderToStaticMarkup(<PlaybookHistory modelId="model" platform="x" />);
  expect(html).toContain('Load latest history');
  expect(html).toContain('Earlier discarded values cannot be recovered');
  expect(html).not.toContain('Use revision');
});
