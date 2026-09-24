import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const mocks = vi.hoisted(() => ({ session: vi.fn(), operations: vi.fn(), getServerLocale: vi.fn() }));
vi.mock('@/lib/api', () => ({ getSession: mocks.session, api: { models: { teamOperations: mocks.operations } } }));
vi.mock('@/lib/server-locale', () => ({ getServerLocale: mocks.getServerLocale }));
vi.mock('@/components/TeamOperationsManager', () => ({ default: () => <p>Shift controls</p> }));
vi.mock('@/components/ModelAssignments', () => ({ default: () => <p>Owner assignments</p> }));
import Page from './page';
const messages: Record<string, string> = {
  'team.pageTitle': 'Equipo y turnos',
  'team.unavailableTitle': 'Operaciones del equipo no disponibles',
  'team.loadFailed': 'No se pudieron cargar los datos del equipo. No se modificó ningún turno ni nota.',
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.operations.mockResolvedValue({ data: { members: [], shifts: [], notes: [] } });
  mocks.getServerLocale.mockResolvedValue({ t: (key: string) => messages[key] ?? key });
});
it.each(['owner', 'manager', 'operator', 'analyst', 'agent', undefined])('shows assignment management only for owner, role=%s', async role => {
  mocks.session.mockResolvedValue({ user: { role } });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'model' }) }));
  expect(html.includes('Owner assignments')).toBe(role === 'owner');
  expect(html).toContain('Shift controls');
  expect(html).toContain('Equipo y turnos');
});

it('localizes the failure shell without claiming a shift or note mutation', async () => {
  mocks.session.mockResolvedValue({ user: { role: 'analyst' } });
  mocks.operations.mockRejectedValue(new Error('unavailable'));
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'model' }) }));
  expect(html).toContain('Operaciones del equipo no disponibles');
  expect(html).toContain('No se modificó ningún turno ni nota.');
});
