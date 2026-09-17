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
