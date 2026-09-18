import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MediaOperationControls from './MediaOperationControls';

it.each([true, false])('makes completed output viewable for edit permission %s', canEdit => {
  const html = renderToStaticMarkup(<MediaOperationControls modelId="model" assetId="source" kind="image" canEdit={canEdit}
    operations={[{ id: 'operation', modelId: 'model', sourceAssetId: 'source', resultVariantId: 'variant', outputAssetId: 'output',
      type: 'image_resize', options: {}, state: 'completed', error: null, createdAt: '', completedAt: '' }]} />);
  expect(html).toContain('View transformed result');
  expect(html).toContain('Loading media preview');
  expect(html).toContain('has not inherited approval');
  expect(html.includes('Queue transform')).toBe(canEdit);
});

it('shows safe lifecycle states and a retry action without exposing provider errors', () => {
  const html = renderToStaticMarkup(<MediaOperationControls modelId="model" assetId="source" kind="image" canEdit
    operations={[
      { id: 'queued', modelId: 'model', sourceAssetId: 'source', resultVariantId: null, outputAssetId: null,
        type: 'image_resize', options: { type: 'image_resize', width: 1080, height: 1350 }, state: 'queued', error: null, createdAt: '', completedAt: null },
      { id: 'running', modelId: 'model', sourceAssetId: 'source', resultVariantId: null, outputAssetId: null,
        type: 'image_resize', options: {}, state: 'running', error: null, createdAt: '', completedAt: null },
      { id: 'failed', modelId: 'model', sourceAssetId: 'source', resultVariantId: null, outputAssetId: null,
        type: 'image_resize', options: { type: 'image_resize', width: 1080, height: 1350 }, state: 'failed', error: 'provider secret and raw stack trace', createdAt: '', completedAt: '' },
    ]} />);
  expect(html).toContain('Queued');
  expect(html).toContain('Running');
  expect(html).toContain('Failed');
  expect(html).toContain('Refresh status');
  expect(html).toContain('Retry transform');
  expect(html).toContain('Review the operation and retry if appropriate.');
  expect(html).not.toContain('provider secret and raw stack trace');
});

it('keeps status refresh visible while hiding retry controls from read-only roles', () => {
  const html = renderToStaticMarkup(<MediaOperationControls modelId="model" assetId="source" kind="image" canEdit={false}
    operations={[{ id: 'failed', modelId: 'model', sourceAssetId: 'source', resultVariantId: null, outputAssetId: null,
      type: 'image_resize', options: {}, state: 'failed', error: 'internal detail', createdAt: '', completedAt: '' }]} />);
  expect(html).toContain('Refresh status');
  expect(html).not.toContain('Retry transform');
  expect(html).not.toContain('internal detail');
});
