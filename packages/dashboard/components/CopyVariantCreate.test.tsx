import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CopyVariantCreate from './CopyVariantCreate';
it('offers named bounded caption and teaser fields without publishing controls', () => {
  const html = renderToStaticMarkup(<CopyVariantCreate modelId="model" assetId="asset" />);
  expect(html).toContain('Caption'); expect(html).toContain('Teaser');
  expect(html).toContain('maxLength="10000"');
  expect(html).toContain('Save copy variant'); expect(html).toContain('saving does not publish');
});
