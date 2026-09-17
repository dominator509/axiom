import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import VariantReviewCreate from './VariantReviewCreate';
it('offers review of saved content without editable overrides or publication', () => {
  const html = renderToStaticMarkup(<VariantReviewCreate modelId="model" variantId="variant" />);
  expect(html).toContain('Send saved variant for review');
  expect(html).not.toContain('<textarea'); expect(html).not.toContain('<input');
  expect(html).not.toContain('Publish');
});
