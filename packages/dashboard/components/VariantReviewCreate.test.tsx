import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import VariantReviewCreate from './VariantReviewCreate';
it('offers review of saved content without editable overrides or publication', () => {
  const html = renderToStaticMarkup(<VariantReviewCreate modelId="model" variantId="variant" />);
  expect(html).toContain('Send saved variant for review');
  expect(html).not.toContain('<textarea'); expect(html).not.toContain('<input');
  expect(html).not.toContain('Publish');
});
it('requires explicit copy for a media-only variant', () => {
  const html = renderToStaticMarkup(<VariantReviewCreate modelId="model" variantId="variant" requiresCaption />);
  expect(html).toContain('Review this media variant'); expect(html).toContain('<textarea');
  expect(html).toContain('maxLength="10000"');
});
it('locks an assigned review to its experiment platform', () => {
  const html = renderToStaticMarkup(<VariantReviewCreate modelId="model" variantId="variant" assignmentId="assignment" requiresCaption initialPlatform="x" />);
  expect(html).toContain('<select disabled="">'); expect(html).toContain('value="x" selected=""');
});
