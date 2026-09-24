import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LocaleProvider from './LocaleProvider';
import MediaOperationControls from './MediaOperationControls';

function render(locale: 'es' | 'pt-BR') {
  return renderToStaticMarkup(
    <LocaleProvider initialLocale={locale}>
      <MediaOperationControls
        modelId="model-1"
        assetId="asset-1"
        kind="video"
        canEdit
        operations={[{
          id: 'operation-1', modelId: 'model-1', sourceAssetId: 'asset-1', resultVariantId: null,
          outputAssetId: null, type: 'video_clip', options: { type: 'video_clip', start: 0, duration: 5 },
          state: 'failed', error: 'provider detail must stay hidden', createdAt: '', completedAt: null,
        }]}
      />
    </LocaleProvider>,
  );
}

it('localizes transform controls and hides provider details in Spanish', () => {
  const html = render('es');
  expect(html).toContain('Recortar, cambiar tamaño o adaptar medios');
  expect(html).toContain('Historial de transformaciones');
  expect(html).toContain('Reintentar transformación');
  expect(html).not.toContain('provider detail must stay hidden');
});

it('localizes video transform controls in Brazilian Portuguese', () => {
  const html = render('pt-BR');
  expect(html).toContain('Recortar, redimensionar ou adaptar mídia');
  expect(html).toContain('Transcodificar vídeo');
  expect(html).toContain('Enfileirar transformação');
});
