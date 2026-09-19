import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import VariantExperimentManager from './VariantExperimentManager';

it('offers named selectable variants and previews rather than a raw UUID form', () => {
  const html = renderToStaticMarkup(<VariantExperimentManager modelId="model" experiments={[]} canEdit candidates={[
    { id: 'candidate', variantType: 'image_resize', outputAssetId: 'output', createdAt: '' },
    { id: 'legacy', variantType: 'crop', outputAssetId: null, createdAt: '' },
  ]} nextCursor="next" />);
  expect(html).toContain('type="checkbox"');
  expect(html).toContain('Preview variant');
  expect(html).toContain('Legacy variant');
  expect(html).toContain('Load more variants');
  expect(html).not.toContain('Variant UUIDs');
});
it('shows conversion counts to read-only users without experiment mutation controls', () => {
  const html = renderToStaticMarkup(<VariantExperimentManager modelId="model" canEdit={false} experiments={[
    { id: 'experiment', modelId: 'model', name: 'Creative test', platform: 'x', variantIds: ['variant'], status: 'running',
      winnerVariantId: null, createdAt: '', updatedAt: '', stats: [{ variantId: 'variant', exposures: 10, outcomes: 5, conversions: 3, metricTotal: 0 }] },
  ]} />);
  expect(html).toContain('3 conversions');
  expect(html).not.toContain('Save experiment');
  expect(html).not.toContain('Pause');
});
it('shows verified guidance provenance and truthful missing-evidence copy', () => {
  const html = renderToStaticMarkup(<VariantExperimentManager modelId="model" experiments={[]} canEdit candidates={[
    { id: 'copy', variantType: 'caption', outputAssetId: 'asset', createdAt: '', copy: { platform: 'instagram', text: 'A vase' }, guidance: {
      guidanceReceiptId: 'bundle:instagram', sourceBundleId: 'bundle', sourceVariantId: null, platform: 'instagram', selectedArm: 'short:question', context: 'learn-v1:scheduled-utc-unknown', hookType: 'question',
    } },
    { id: 'copy-missing', variantType: 'teaser', outputAssetId: 'asset', createdAt: '', copy: { platform: 'instagram', text: 'A teaser' }, guidance: null },
  ]} />);
  expect(html).toContain('Verified guidance attribution');
  expect(html).toContain('recorded provenance only');
  expect(html).toContain('Guidance attribution unavailable');
});
it.each([0, 1])('requires candidate outcomes before offering winner selection: %s', outcomes => {
  const html = renderToStaticMarkup(<VariantExperimentManager modelId="model" canEdit experiments={[
    { id: 'experiment', modelId: 'model', name: 'Creative test', platform: 'x', variantIds: ['variant'], status: 'running',
      winnerVariantId: null, createdAt: '', updatedAt: '', stats: [{ variantId: 'variant', exposures: 1, outcomes, conversions: 0, metricTotal: 0 }] },
  ]} />);
  expect(html).toContain('Select as winner');
  expect(html).toContain('not a statistical-significance claim');
  expect(/disabled="">Select as winner/.test(html)).toBe(outcomes === 0);
});
