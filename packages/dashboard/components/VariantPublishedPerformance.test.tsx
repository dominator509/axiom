import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import VariantPublishedPerformance from './VariantPublishedPerformance';
it('distinguishes stored provider observations from manual outcomes and sales attribution', () => {
  const html = renderToStaticMarkup(<VariantPublishedPerformance modelId="model" experimentId="experiment" />);
  expect(html).toContain('Refresh published performance');
  expect(html).toContain('separate from manual outcomes');
  expect(html).toContain('does not establish');
  expect(html).not.toContain('0 views');
});
