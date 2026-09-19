import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ScrapeResult from './ScrapeResult';

const profile = {
  platform: 'instagram',
  displayName: 'Creator',
  profileUrl: 'https://example.com/creator',
  bio: null,
  followers: 0,
  following: null,
  posts: null,
  items: [],
  error: null as 'unavailable' | null,
};

it('distinguishes observed zero from absent and invalid counts', () => {
  const html = renderToStaticMarkup(<ScrapeResult result={{ kind: 'social', state: 'completed', profiles: [profile], observedProfiles: 1, failedProfiles: 0, totalItems: 0, missingCount: null }} />);
  expect(html).toContain('<dd>0</dd>');
  expect(html.match(/<dd>Unavailable<\/dd>/g)).toHaveLength(2);
  expect(html).toContain('not verified provider analytics');
});

it('shows partial competitor failure beside the successful result without fake engagement', () => {
  const html = renderToStaticMarkup(<ScrapeResult result={{ kind: 'competitor', state: 'partial', profiles: [
    { ...profile, followers: 1200, posts: null },
    { ...profile, platform: 'tiktok', displayName: null, profileUrl: null, error: 'unavailable' },
  ], observedProfiles: 1, failedProfiles: 1, totalItems: 0, missingCount: null }} />);
  expect(html).toContain('<dd>1,200</dd>');
  expect(html).toContain('Profile details unavailable.');
  expect(html).not.toContain('Engagement');
  expect(html).not.toContain('Raw research response');
  expect(html).not.toContain('HTTP 403');
});

it('renders untrusted profile content as text, never remote images or active links', () => {
  const html = renderToStaticMarkup(<ScrapeResult result={{ kind: 'social', state: 'completed', profiles: [{ ...profile, displayName: '<script>bad</script>', profileUrl: 'https://example.com/safe', followers: 1 }], observedProfiles: 1, failedProfiles: 0, totalItems: 0, missingCount: null }} />);
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img');
  expect(html).not.toContain('href=');
});

it('renders empty and unavailable states without presenting success', () => {
  const empty = renderToStaticMarkup(<ScrapeResult result={{ kind: 'social', state: 'empty', profiles: [], observedProfiles: 0, failedProfiles: 0, totalItems: 0, missingCount: null }} />);
  const unavailable = renderToStaticMarkup(<ScrapeResult result={{ kind: 'social', state: 'unavailable', profiles: [], observedProfiles: 0, failedProfiles: 0, totalItems: 0, missingCount: null }} />);
  expect(empty).toContain('No observable results');
  expect(unavailable).toContain('Research unavailable');
  expect(empty).not.toContain('Completed research');
});
