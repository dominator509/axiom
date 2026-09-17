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
