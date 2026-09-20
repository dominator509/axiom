import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import VariantGuidanceAttribution from './VariantGuidanceAttribution';

vi.mock('./LocaleProvider', () => ({ useLocale: () => ({ t: (key: string) => key }) }));

it('renders a refreshable selected-guidance attribution surface', () => {
  const html = renderToStaticMarkup(<VariantGuidanceAttribution modelId="model" experimentId="experiment" />);
  expect(html).toContain('caption.guidance attribution');
  expect(html).toContain('Refresh guidance attribution');
});
