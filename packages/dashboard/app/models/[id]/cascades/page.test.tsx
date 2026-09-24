import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const session = vi.hoisted(() => vi.fn());
const getServerLocale = vi.hoisted(() => vi.fn());
const cascadeTemplates = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  getSession: session,
  api: { models: { cascadeTemplates } },
}));
vi.mock('@/lib/server-locale', () => ({ getServerLocale }));
vi.mock('@/components/CascadeTemplateManager', () => ({
  default: ({ modelId, canEdit }: { modelId: string; canEdit: boolean }) => <div>Cascade manager {modelId} {canEdit ? 'editable' : 'read-only'}</div>,
}));

import Page from './page';

const messages: Record<string, string> = {
  'cascades.title': 'Programaciones de cascadas',
  'cascades.unavailableTitle': 'Programaciones de cascadas no disponibles',
  'cascades.loadFailed': 'No se pudieron cargar las plantillas. No se modificó ningún destino programado.',
};

vi.mocked(getServerLocale).mockResolvedValue({ t: (key: string) => messages[key] ?? key });

it('localizes the loaded route shell and preserves edit scope', async () => {
  session.mockResolvedValue({ user: { role: 'manager' } });
  cascadeTemplates.mockResolvedValue({ data: [] });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'model-1' }) }));
  expect(html).toContain('Programaciones de cascadas');
  expect(html).toContain('Cascade manager model-1 editable');
});

it('localizes the failure shell without claiming a schedule mutation', async () => {
  session.mockResolvedValue({ user: { role: 'analyst' } });
  cascadeTemplates.mockRejectedValue(new Error('unavailable'));
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'model-1' }) }));
  expect(html).toContain('Programaciones de cascadas no disponibles');
  expect(html).toContain('No se modificó ningún destino programado.');
});
