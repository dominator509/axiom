import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/generation-status', () => ({ watchGeneration: () => () => undefined }));
vi.mock('./BundleMedia', () => ({ default: () => <span>preview</span> }));
vi.mock('./GenerationRetry', () => ({ default: () => <span>retry</span> }));
vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    locale: 'es',
    setLocale: () => undefined,
    t: (key: string) => ({
      'generation.checking': 'Comprobando el estado de la generación…',
      'generation.queued': 'La generación de Grok está en cola y espera a un trabajador.',
      'generation.running': 'La generación de Grok está en curso.',
      'generation.failedNoAsset': 'El trabajo de generación terminó sin adjuntar un recurso.',
      'generation.jobMissing': 'No hay ningún trabajo de generación de medios asociado con este paquete.',
      'generation.openApprovals': 'Abrir Aprobaciones',
      'generation.openIncidents': 'Abrir Incidentes',
      'generation.openReviewDrafts': 'Abrir Borradores de revisión',
    }[key] ?? key),
  }),
}));
import GenerationProgress from './GenerationProgress';

describe('GenerationProgress locale coverage', () => {
  it('renders generation status and review navigation in Spanish', () => {
    const html = renderToStaticMarkup(<GenerationProgress bundleId="bundle" modelId="model" />);
    expect(html).toContain('Comprobando el estado de la generación');
    expect(html).toContain('Abrir Aprobaciones');
    expect(html).not.toContain('Grok generation is queued');
  });
});
