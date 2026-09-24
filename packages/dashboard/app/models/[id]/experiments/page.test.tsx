import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const session = vi.hoisted(() => vi.fn());
const getServerLocale = vi.hoisted(() => vi.fn());
const variantExperiments = vi.hoisted(() => vi.fn());
const variantCandidates = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  getSession: session,
  api: { models: { variantExperiments, variantCandidates } },
}));
vi.mock('@/lib/server-locale', () => ({ getServerLocale }));
vi.mock('@/components/VariantExperimentManager', () => ({
  default: ({ modelId, canEdit }: { modelId: string; canEdit: boolean }) => <div>Variant manager {modelId} {canEdit ? 'editable' : 'read-only'}</div>,
}));

import Page from './page';

const messages: Record<string, string> = {
  'experiments.title': 'Experimentos de variantes',
  'experiments.unavailableTitle': 'Experimentos de variantes no disponibles',
  'experiments.loadFailed': 'No se pudieron cargar los experimentos. No se modificó ningún estado de experimento.',
};

vi.mocked(getServerLocale).mockResolvedValue({ t: (key: string) => messages[key] ?? key });

it('localizes the loaded route shell and preserves edit scope', async () => {
  session.mockResolvedValue({ user: { role: 'operator' } });
  variantExperiments.mockResolvedValue({ data: [] });
  variantCandidates.mockResolvedValue({ data: [], meta: { next_cursor: null } });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'model-1' }) }));
  expect(html).toContain('Experimentos de variantes');
  expect(html).toContain('Variant manager model-1 editable');
});

it('localizes the failure shell without claiming an experiment mutation', async () => {
  session.mockResolvedValue({ user: { role: 'analyst' } });
  variantExperiments.mockRejectedValue(new Error('unavailable'));
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'model-1' }) }));
  expect(html).toContain('Experimentos de variantes no disponibles');
  expect(html).toContain('No se modificó ningún estado de experimento.');
});
