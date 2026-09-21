import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import VariantGuidanceAttribution from './VariantGuidanceAttribution';

vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    locale: 'en',
    setLocale: () => undefined,
    t: (key: string) => ({
      'variant.guidance.attribution': 'Guidance attribution',
      'variant.guidance.attributionRefresh': 'Refresh guidance attribution',
    }[key] ?? key),
  }),
}));

it('renders a refreshable selected-guidance attribution surface', () => {
  const html = renderToStaticMarkup(<VariantGuidanceAttribution modelId="model" experimentId="experiment" />);
  expect(html).toContain('Guidance attribution');
  expect(html).toContain('Refresh guidance attribution');
});
