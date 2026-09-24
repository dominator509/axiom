import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LocaleProvider from './LocaleProvider';
import GenerationRetry from './GenerationRetry';

function render(locale: 'es' | 'ja') {
  return renderToStaticMarkup(
    <LocaleProvider initialLocale={locale}>
      <GenerationRetry modelId="model-1" bundleId="bundle-1" blocked={false} onQueued={() => undefined} />
    </LocaleProvider>,
  );
}

it('localizes the retry workflow while preserving the explicit approval boundary', () => {
  const html = render('es');
  expect(html).toContain('Reintentar generación');
  expect(html).toContain('Apruebo una generación nueva');
  expect(html).toContain('Revisar modificaciones sugeridas');
});

it('localizes the retry workflow in Japanese without translating provider-facing data', () => {
  const html = render('ja');
  expect(html).toContain('生成を再試行');
  expect(html).toContain('新しい生成とプロバイダー料金の可能性を承認します。');
});
