import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, formatDate, LocaleCatalog, type MessageKey, type SupportedLocale } from '@axiom/core';
import type { PlaybookGuideline, PostTarget } from '@/lib/api';
import PlaybookCadence, { cadenceCounts, currentUtcWeek } from './PlaybookCadence';

const week = currentUtcWeek(new Date('2030-01-01T00:30:00Z'));
const post = (id: string, state: string, platform = 'x'): PostTarget => ({ id, state, platform, bundleId: 'bundle', scheduledFor: '2030-01-01T18:00:00Z', remoteId: null, error: null });
const guideline: PlaybookGuideline = { id: 'g', modelId: 'm', platform: 'x', cadencePerWeek: 3, optimalTimes: ['18:00'], revision: 2, upsellStrategy: '', updatedAt: '' };
const catalog = new LocaleCatalog(CATALOGS);
const t = (locale: SupportedLocale) => (key: MessageKey, values?: Record<string, string | number>) => catalog.t(locale, key, values);
it('uses a full UTC Monday week across month and year boundaries', () => {
  expect(week).toEqual({ from: '2029-12-31T00:00:00.000Z', to: '2030-01-06T23:59:59.999Z' });
});
it('excludes failed, canceled, unknown, other-platform, duplicate and out-of-week posts', () => {
  expect(cadenceCounts([post('1', 'published'), post('2', 'pending'), post('2', 'pending'), post('3', 'failed'), post('4', 'canceled'), post('5', 'publishing'), post('6', 'pending', 'instagram'), { ...post('7', 'published'), scheduledFor: '2029-01-01T00:00:00Z' }], 'x', week.from, week.to)).toEqual({ published: 1, scheduled: 1 });
});
it('shows deficit without representing the plan as confirmed publication', () => {
  const html = renderToStaticMarkup(<PlaybookCadence modelId="m" guidelines={[guideline]} posts={[post('1', 'pending')]} {...week} unavailable={false} locale="en" t={t('en')} />);
  expect(html).toContain('Under planned cadence by 2 posts');
  expect(html).toContain('No schedule is changed automatically');
  expect(html).toContain('/models/m/playbook');
});
it('does not count a pending remote handoff as safely scheduled', () => {
  expect(cadenceCounts([{ ...post('handoff', 'pending'), remoteId: 'provider-id' }], 'x', week.from, week.to)).toEqual({ scheduled: 0, published: 0 });
});
it('does not show a deficit when fetching evidence failed', () => {
  const html = renderToStaticMarkup(<PlaybookCadence modelId="m" guidelines={[guideline]} posts={[]} {...week} unavailable locale="en" t={t('en')} />);
  expect(html).toContain('No adherence conclusion');
  expect(html).not.toContain('Under planned cadence');
});

it('renders cadence copy and week dates from the selected locale', () => {
  const posts = [post('1', 'published'), post('2', 'published'), post('3', 'published')];
  const html = renderToStaticMarkup(<PlaybookCadence modelId="m" guidelines={[guideline]} posts={posts} {...week} unavailable={false} locale="de" t={t('de')} />);
  expect(html).toContain(catalog.t('de', 'playbook.cadenceSectionAria'));
  expect(html).toContain(catalog.t('de', 'playbook.cadenceCovered'));
  expect(html).toContain(catalog.t('de', 'playbook.cadenceWeek', {
    from: formatDate(new Date(week.from), 'de', { dateStyle: 'medium', timeZone: 'UTC' }),
    to: formatDate(new Date(week.to), 'de', { dateStyle: 'medium', timeZone: 'UTC' }),
  }));
  expect(html).not.toContain('Weekly playbook cadence');
});
