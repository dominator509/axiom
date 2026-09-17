import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PerformancePatterns from './PerformancePatterns';
it('distinguishes unavailable from insufficient evidence', () => {
  expect(renderToStaticMarkup(<PerformancePatterns />)).toContain('unavailable');
  expect(renderToStaticMarkup(<PerformancePatterns patterns={{ groups: [], truncated: false, minimumSample: 3 }} />)).toContain('at least 3');
});
it('shows sample size, scheduled UTC meaning, score units and observational limits', () => {
  const html = renderToStaticMarkup(<PerformancePatterns patterns={{ groups: [{ platform: 'instagram', arm: 'short:question', context: 'learn-v1:scheduled-utc-3', sampleSize: 14, meanScore: 1.234 }], truncated: true, minimumSample: 3 }} />);
  for (const text of ['14 labeled exemplars', '1.23', '18:00–23:59 UTC', 'not necessarily actual publication', 'No conversion lift', '20 highest-scoring']) expect(html).toContain(text);
});
