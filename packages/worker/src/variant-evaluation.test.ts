import { expect, it } from 'vitest';
import { assessVariantPerformance } from './variant-evaluation.js';
const samples = (variantId: string, rate: number, count = 20) => Array.from({ length: count }, (_, i) => ({
  targetId: `${variantId}-${i}`, variantId, views: 100, engagementRate: rate, collectedAt: new Date('2026-09-17'),
}));
it('requires enough distinct published targets for every candidate', () => {
  expect(assessVariantPerformance(['a', 'b'], [...samples('a', 1), ...samples('b', 0, 19)]).status).toBe('insufficient');
  expect(assessVariantPerformance(['a', 'b'], [...samples('a', 1), ...samples('a', 1)]).status).toBe('insufficient');
});
it('does not infer a winner from a tie or small difference', () => {
  expect(assessVariantPerformance(['a', 'b'], [...samples('a', .3), ...samples('b', .2)]).status).toBe('inconclusive');
});
it('identifies clear separation without changing any experiment', () => {
  expect(assessVariantPerformance(['a', 'b'], [...samples('a', 1), ...samples('b', 0)])).toMatchObject({ status: 'candidate', candidateVariantId: 'a' });
});
it('rejects truncated pools and invalid rates', () => {
  expect(assessVariantPerformance(['a', 'b'], [], true).status).toBe('unavailable');
  expect(assessVariantPerformance(['a', 'b'], [...samples('a', NaN), ...samples('b', 0)]).status).toBe('insufficient');
});
