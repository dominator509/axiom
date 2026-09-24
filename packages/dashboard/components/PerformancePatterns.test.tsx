import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { testT } from './testLocale';
const localeState = vi.hoisted(() => ({ locale: 'en' }));
vi.mock('./LocaleProvider', () => ({ useLocale: () => ({ locale: localeState.locale, setLocale: () => undefined, t: testT }) }));
import PerformancePatterns from './PerformancePatterns';
it('distinguishes unavailable from insufficient evidence', () => {
  expect(renderToStaticMarkup(<PerformancePatterns />)).toContain('unavailable');
  expect(renderToStaticMarkup(<PerformancePatterns patterns={{ groups: [], truncated: false, minimumSample: 3 }} />)).toContain('at least 3');
});
it('shows verified recipe dimensions, schedule meaning, score units and observational limits', () => {
  const html = renderToStaticMarkup(<PerformancePatterns patterns={{ groups: [{ platform: 'instagram', arm: 'short:question', context: 'learn-v1:scheduled-utc-3', mediaFormat: 'video/mp4', tosVerdict: 'pass', publishedHourUtc: 20, sampleSize: 14, meanScore: 1.234 }], truncated: true, minimumSample: 3 }} />);
  for (const text of ['14 labeled exemplars', '1.23', '18:00–23:59 UTC', 'video/mp4', 'ToS verdict at publication: pass', 'not necessarily actual publication', 'No conversion lift', '20 highest-scoring']) expect(html).toContain(text);
});
it('shows bounded v2 hook and format dimensions', () => {
  const html = renderToStaticMarkup(<PerformancePatterns patterns={{ groups: [{ platform: 'instagram', arm: 'v2:short:question:hook=question:format=reel', context: 'learn-v2:scheduled-utc-2', sampleSize: 3, meanScore: 1 }], truncated: false, minimumSample: 3 }} />);
  expect(html).toContain('question hook');
  expect(html).toContain('reel format');
  expect(html).toContain('12:00–17:59 UTC');
});
it('shows a verified temporal arm qualifier without inventing one for old arms', () => {
  const html = renderToStaticMarkup(<PerformancePatterns patterns={{ groups: [{ platform: 'instagram', arm: 'v2:short:question:hook=question:format=reel:time=morning', context: 'learn-v2:scheduled-utc-2', sampleSize: 3, meanScore: 1 }], truncated: false, minimumSample: 3 }} />);
  expect(html).toContain('morning timing');
  const legacy = renderToStaticMarkup(<PerformancePatterns patterns={{ groups: [{ platform: 'instagram', arm: 'v2:short:question:hook=question:format=reel', context: 'learn-v2:scheduled-utc-2', sampleSize: 3, meanScore: 1 }], truncated: false, minimumSample: 3 }} />);
  expect(legacy).not.toContain(' timing');
});
it('marks organization-shared patterns without exposing a source talent', () => {
  const html = renderToStaticMarkup(<PerformancePatterns patterns={{ groups: [{ platform: 'instagram', arm: 'short:question', context: 'learn-v1:scheduled-utc-2', sampleSize: 6, meanScore: 0.7, sourceScope: 'organization' }], truncated: false, minimumSample: 3 }} />);
  expect(html).toContain('Shared organization pattern');
});
it('formats pattern counts and scores with the selected locale', () => {
  localeState.locale = 'de';
  const html = renderToStaticMarkup(<PerformancePatterns patterns={{ groups: [{ platform: 'instagram', arm: 'short:question', context: 'learn-v1:scheduled-utc-3', sampleSize: 12345, meanScore: 12.345 }], truncated: false, minimumSample: 1234 }} />);
  expect(html).toContain('12.345 labeled exemplars');
  expect(html).toContain('12,35');
  localeState.locale = 'en';
});
