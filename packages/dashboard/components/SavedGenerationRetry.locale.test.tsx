import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LocaleProvider from './LocaleProvider';
import SavedGenerationRetry from './SavedGenerationRetry';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

it('localizes the persistent retry entry point while retaining its generated-media scope', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="es">
      <SavedGenerationRetry modelId="model-1" bundleId="bundle-1" blocked={false} />
    </LocaleProvider>,
  );
  expect(html).toContain('Opciones para reintentar la generación de medios');
  expect(html).toContain('Disponible para paquetes de imágenes y vídeos generados');
  expect(html).toContain('Reintentar generación');
});
