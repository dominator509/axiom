import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const session = vi.hoisted(() => vi.fn());
const getServerLocale = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ getSession: session }));
vi.mock('@/lib/server-locale', () => ({ getServerLocale }));
vi.mock('@/components/WorkspaceMembers', () => ({ default: () => <div>Member administration</div> }));
import Page from './page';
import { workspaceDestinationAllowed } from '@/lib/navigation-role';

const messages: Record<string, string> = {
  'members.title': 'Miembros del espacio de trabajo',
  'members.accessDescription': 'Solo el propietario del espacio de trabajo puede gestionar el acceso de los miembros.',
  'members.description': 'Gestiona los miembros existentes de este espacio de trabajo.',
  'members.scopeNote': 'Las asignaciones y los turnos de talento se gestionan desde la página Equipo.',
  'members.backToWorkspace': 'Volver al espacio de trabajo',
};

beforeEach(() => {
  vi.clearAllMocks();
  getServerLocale.mockResolvedValue({ t: (key: string) => messages[key] ?? key });
});

it.each(['operator', 'manager', 'analyst', 'agent', 'model', 'chatter', 'content_creator', undefined])('denies member controls and navigation to %s', async role => {
  session.mockResolvedValue({ user: { role } });
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('Solo el propietario'); expect(html).not.toContain('Member administration');
  expect(workspaceDestinationAllowed(role, '/members')).toBe(false);
});
it('makes owner administration discoverable', async () => {
  session.mockResolvedValue({ user: { role: 'owner' } });
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('Miembros del espacio de trabajo');
  expect(html).toContain('Member administration');
  expect(workspaceDestinationAllowed('owner', '/members')).toBe(true);
});
