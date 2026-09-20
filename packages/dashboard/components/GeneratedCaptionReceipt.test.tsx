import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    locale: 'en',
    setLocale: () => undefined,
    t: (key: string) => ({
      'caption.savedCaptions': 'Saved destination captions',
      'caption.savedDescription': 'These captions are saved in the bundle for review. The creative variants below are suggestions, not additional scheduled posts.',
      'caption.fallback': 'Optional AI enrichment was unavailable or returned no caption. The base caption was saved. Review it before approval; do not regenerate the whole bundle just to check this result.',
      'caption.enriched': 'AI-enriched caption saved.',
      'caption.notRequested': 'AI enrichment was not requested.',
      'caption.statusUnavailable': 'Enrichment status is unavailable for this receipt.',
    }[key] ?? key),
  }),
}));
import GeneratedCaptionReceipt from './GeneratedCaptionReceipt';

it('shows saved destination copy and distinguishes partial enrichment failures', () => {
  const html = renderToStaticMarkup(<GeneratedCaptionReceipt captions={{ instagram: 'Saved IG', threads: 'Saved Threads' }} enrichment={{ instagram: 'enriched', threads: 'fallback' }} />);
  expect(html).toContain('Saved IG'); expect(html).toContain('Saved Threads');
  expect(html).toContain('AI-enriched caption saved');
  expect(html).toContain('base caption was saved');
  expect(html).toContain('not additional scheduled posts');
});
it('does not infer successful enrichment for an older or malformed receipt', () => {
  const html = renderToStaticMarkup(<GeneratedCaptionReceipt captions={{ x: 'Caption' }} enrichment={{ x: true }} />);
  expect(html).toContain('status is unavailable');
  expect(html).not.toContain('AI-enriched caption saved');
});
it('does not render malformed captions or execute embedded markup', () => {
  expect(renderToStaticMarkup(<GeneratedCaptionReceipt captions={null} enrichment={null} />)).toBe('');
  const html = renderToStaticMarkup(<GeneratedCaptionReceipt captions={{ x: '<script>bad</script>', threads: {} }} enrichment={{ x: 'not_requested' }} />);
  expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
  expect(html).toContain('was not requested');
});
