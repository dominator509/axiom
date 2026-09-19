import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PlaybookGuideline, PostTarget } from '@/lib/api';
import PlaybookCadence, { cadenceCounts, currentUtcWeek } from './PlaybookCadence';

const week = currentUtcWeek(new Date('2030-01-01T00:30:00Z'));
const post = (id: string, state: string, platform = 'x'): PostTarget => ({ id, state, platform, bundleId: 'bundle', scheduledFor: '2030-01-01T18:00:00Z', remoteId: null, error: null });
const guideline: PlaybookGuideline = { id: 'g', modelId: 'm', platform: 'x', cadencePerWeek: 3, optimalTimes: ['18:00'], revision: 2, upsellStrategy: '', updatedAt: '' };
it('uses a full UTC Monday week across month and year boundaries', () => {
  expect(week).toEqual({ from: '2029-12-31T00:00:00.000Z', to: '2030-01-06T23:59:59.999Z' });
});
it('excludes failed, canceled, unknown, other-platform, duplicate and out-of-week posts', () => {
  expect(cadenceCounts([post('1', 'published'), post('2', 'pending'), post('2', 'pending'), post('3', 'failed'), post('4', 'canceled'), post('5', 'publishing'), post('6', 'pending', 'instagram'), { ...post('7', 'published'), scheduledFor: '2029-01-01T00:00:00Z' }], 'x', week.from, week.to)).toEqual({ published: 1, scheduled: 1 });
});
it('shows deficit without representing the plan as confirmed publication', () => {
  const html = renderToStaticMarkup(<PlaybookCadence modelId="m" guidelines={[guideline]} posts={[post('1', 'pending')]} {...week} unavailable={false} />);
  expect(html).toContain('Under planned cadence by 2 posts');
  expect(html).toContain('No schedule is changed automatically');
  expect(html).toContain('/models/m/playbook');
});
it('does not count a pending remote handoff as safely scheduled', () => {
  expect(cadenceCounts([{ ...post('handoff', 'pending'), remoteId: 'provider-id' }], 'x', week.from, week.to)).toEqual({ scheduled: 0, published: 0 });
});
it('does not show a deficit when fetching evidence failed', () => {
  const html = renderToStaticMarkup(<PlaybookCadence modelId="m" guidelines={[guideline]} posts={[]} {...week} unavailable />);
  expect(html).toContain('No adherence conclusion');
  expect(html).not.toContain('Under planned cadence');
});
