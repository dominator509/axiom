import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LocaleProvider from './LocaleProvider';
import AdaptationControls from './AdaptationControls';

function render(locale: 'en' | 'es' | 'ja') {
  return renderToStaticMarkup(
    <LocaleProvider initialLocale={locale}>
      <AdaptationControls bundleId="bundle-1" revisionId="revision-1" platforms={['instagram', 'x']} />
    </LocaleProvider>,
  );
}

it('renders the English child-control labels and preserves platform data', () => {
  const html = render('en');
  expect(html).toContain('Adapt for another platform or tone');
  expect(html).toContain('Target platform');
  expect(html).toContain('Adapt this caption for the selected platform');
  expect(html).toContain('instagram');
  expect(html).toContain('x');
});

it('renders Spanish and Japanese child-control copy without translating platform identifiers', () => {
  const spanish = render('es');
  expect(spanish).toContain('Adaptar para otra plataforma o tono');
  expect(spanish).toContain('Plataforma de destino');
  expect(spanish).toContain('instagram');

  const japanese = render('ja');
  expect(japanese).toContain('別のプラットフォームまたはトーンに適応');
  expect(japanese).toContain('対象プラットフォーム');
  expect(japanese).toContain('x');
});
