import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import VariantEvaluationReport from './VariantEvaluationReport';
const assessment = { status: 'candidate', sampleSize: 20, radius: .33, candidateVariantId: 'a', summaries: [
  { variantId: 'a', posts: 20, mean: 1 }, { variantId: 'b', posts: 20, mean: 0 },
] };
const render = (value: unknown, winner: string | null = 'a') => renderToStaticMarkup(<VariantEvaluationReport evaluation={value} variantIds={['a', 'b']} winnerVariantId={winner} />);
it('shows saved evidence and its limitations', () => {
  const html = render({ policy: 'fixed-post-engagement-v1', assessment });
  expect(html).toContain('Frozen automatic evaluation');
  expect(html).toContain('100.00%');
  expect(html).toContain('20 published posts');
  expect(html).toContain('does not prove causal lift');
});
it('explains an inconclusive completion without inventing a winner', () => {
  expect(render({ policy: 'fixed-post-engagement-v1', assessment: { ...assessment, status: 'inconclusive', candidateVariantId: null } }, null)).toContain('No winner was selected');
});
it.each([{}, { policy: 'unknown', assessment }, { policy: 'fixed-post-engagement-v1', assessment: { ...assessment, summaries: [{ variantId: 'a', posts: 20, mean: NaN }] } }])('fails closed for malformed evidence', value => {
  expect(render(value)).toContain('could not be verified');
});
it('rejects a mismatched saved winner and hides absent evaluations', () => {
  expect(render({ policy: 'fixed-post-engagement-v1', assessment }, 'b')).toContain('could not be verified');
  expect(render(null)).toBe('');
});
