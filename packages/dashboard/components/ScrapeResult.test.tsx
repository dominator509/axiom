import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ScrapeResult from './ScrapeResult';

it('distinguishes observed zero from absent and invalid counts', () => {
  const html = renderToStaticMarkup(<ScrapeResult kind="social" result={{ followers: 0, following: null, posts: -1 }} />);
  expect(html).toContain('<dd>0</dd>');
  expect(html.match(/<dd>Unavailable<\/dd>/g)).toHaveLength(2);
  expect(html).toContain('not verified provider analytics');
});

it('shows partial competitor failure beside the successful result without fake engagement', () => {
  const html = renderToStaticMarkup(<ScrapeResult kind="competitor" result={{ results: [
    { platform: 'instagram', followers: 1200, posts: null },
    { platform: 'tiktok', error: 'HTTP 403', followers: null },
  ] }} />);
  expect(html).toContain('<dd>1,200</dd>');
  expect(html).toContain('Lookup failed: HTTP 403');
  expect(html).not.toContain('Engagement');
  expect(html).toContain('<summary>Raw research response</summary>');
});

it('renders untrusted profile content as text, never remote images or active links', () => {
  const html = renderToStaticMarkup(<ScrapeResult kind="social" result={{ display_name: '<script>bad</script>', profile_url: 'javascript:bad()', avatar_url: 'https://tracker.invalid/pixel', followers: 1 }} />);
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img');
  expect(html).not.toContain('href=');
});

it.each([null, [], 'bad'])('handles malformed stored results: %s', result => {
  expect(renderToStaticMarkup(<ScrapeResult kind="social" result={result} />)).toContain('could not be displayed');
});
