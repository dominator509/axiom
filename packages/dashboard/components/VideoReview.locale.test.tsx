import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LocaleProvider from './LocaleProvider';
import VideoReview from './VideoReview';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function render(locale: 'es' | 'ja') {
  return renderToStaticMarkup(
    <LocaleProvider initialLocale={locale}>
      <VideoReview bundleId="bundle-1" scanId="scan-1" platforms={['instagram']} />
    </LocaleProvider>,
  );
}

it('localizes Spanish safety and required-review copy while preserving provider data', () => {
  const html = render('es');
  expect(html).toContain('Revisión de cumplimiento del vídeo completo');
  expect(html).toContain('El análisis automático toma dos fotogramas por segundo');
  expect(html).toContain('Acepto este vídeo y pie de foto para instagram.');
  expect(html).toContain('Registrar revisión de cumplimiento');
});

it('localizes Japanese safety copy and retains the destination identifier', () => {
  const html = render('ja');
  expect(html).toContain('動画全体のコンプライアンスレビュー');
  expect(html).toContain('この動画とキャプションを instagram 用として承認します。');
  expect(html).toContain('コンプライアンスレビューを記録');
});
