import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const session = vi.hoisted(() => vi.fn());
const getServerLocale = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ getSession: session }));
vi.mock('@/lib/server-locale', () => ({ getServerLocale }));
vi.mock('@/components/GrokConnection', () => ({ default: () => <div>Own account connection controls</div> }));
vi.mock('@/components/GrokR2Storage', () => ({ default: () => <div>Storage credential controls</div> }));
import Page from './page';
import { workspaceDestinationAllowed } from '@/lib/navigation-role';

const messages: Record<string, string> = {
  'connection.accessTitle': 'Acceso a la conexión de Grok',
  'connection.accessDescription': 'Tu rol no incluye gestionar cuentas de generación ni almacenamiento.',
  'connection.backToWorkspace': 'Volver al espacio de trabajo',
  'connection.grokTitle': 'Conecta tu cuenta de Grok',
  'connection.grokDescription': 'Esto solo conecta tu cuenta. No genera ni publica medios.',
  'connection.storagePrivacyNote': 'El almacenamiento es privado para tu cuenta en este espacio de trabajo.',
};

beforeEach(() => {
  vi.clearAllMocks();
  getServerLocale.mockResolvedValue({ t: (key: string) => messages[key] ?? key });
});
it.each(['owner', 'manager', 'operator'])('retains generation connection and storage controls for %s', async role => {
  session.mockResolvedValue({ user: { role } });
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('Own account connection controls');
  expect(html).toContain('Storage credential controls');
  expect(html).toContain('Conecta tu cuenta de Grok');
  expect(workspaceDestinationAllowed(role, '/connections/grok')).toBe(true);
});
it('shows Creator own-account connection and private storage controls', async () => {
  session.mockResolvedValue({ user: { role: 'content_creator' } });
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('Own account connection controls');
  expect(html).toContain('Storage credential controls');
  expect(html).toContain('El almacenamiento es privado para tu cuenta');
});
it.each(['chatter', 'model', 'analyst', 'agent', 'unknown', undefined])('denies direct page controls and navigation for %s', async role => {
  session.mockResolvedValue({ user: { role } });
  const html = renderToStaticMarkup(await Page());
  expect(html).not.toContain('Own account connection controls');
  expect(html).not.toContain('Storage credential controls');
  expect(html).toContain('Volver al espacio de trabajo');
  expect(workspaceDestinationAllowed(role, '/connections/grok')).toBe(false);
});
