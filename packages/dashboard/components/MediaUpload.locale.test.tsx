import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    locale: 'pt-BR',
    setLocale: () => undefined,
    t: (key: string) => ({
      'media.uploadSection': 'Enviar mídia',
      'media.uploadSource': 'Enviar mídia de origem',
      'media.file': 'Arquivo de mídia',
      'media.removeMetadata': 'Remover metadados e procedência incorporada (opcional)',
      'media.uploadLimits': 'JPEG/PNG até 20 MB; MP4 até 64 MB.',
      'media.uploading': 'Enviando e processando…',
      'media.checkSameUpload': 'Verificar o mesmo envio',
      'media.upload': 'Enviar mídia',
    }[key] ?? key),
  }),
}));
import MediaUpload from './MediaUpload';

describe('MediaUpload locale coverage', () => {
  it('renders source-upload controls in Brazilian Portuguese', () => {
    const html = renderToStaticMarkup(<MediaUpload modelId="model" />);
    expect(html).toContain('Enviar mídia de origem');
    expect(html).toContain('Arquivo de mídia');
    expect(html).toContain('Enviar mídia');
    expect(html).not.toContain('Upload source media');
  });
});
