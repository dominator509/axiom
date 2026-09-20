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
      'generation.queued': 'La generación de Grok está en cola o ejecutándose.',
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
    expect(html).toContain('La generación de Grok está en cola');
    expect(html).toContain('Abrir Aprobaciones');
    expect(html).not.toContain('Grok generation queued or running');
  });
});
