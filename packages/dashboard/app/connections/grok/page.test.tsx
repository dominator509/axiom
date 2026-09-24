import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const session = vi.hoisted(() => vi.fn());
const getServerLocale = vi.hoisted(() => vi.fn());
const providers = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ getSession: session, api: { llm: { providers } } }));
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
  'connection.capabilitiesTitle': 'Capacidades de transporte del proveedor',
  'connection.capabilitiesDescription': 'Los transportes permitidos no confirman una conexión ni el estado del proveedor.',
  'connection.capabilitiesUnavailable': 'Estado de capacidades no disponible.',
  'connection.policyAvailable': 'Transporte permitido',
  'connection.policyUnavailable': 'No disponible según la política actual',
  'connection.transportLocal': 'Transporte local de vLLM',
  'connection.transportSubscription': 'Transporte con suscripción propia',
  'connection.transportUnsupported': 'Sin transporte compatible',
  'connection.capabilitiesReason': 'No hay un transporte oficial compatible basado en suscripción.',
};

beforeEach(() => {
  vi.clearAllMocks();
  getServerLocale.mockResolvedValue({ t: (key: string) => messages[key] ?? key });
  providers.mockResolvedValue({ capabilities: [
    { provider: 'vllm', available: true, transport: 'local', auth: 'none', operatorApiCost: false, reason: null },
    { provider: 'venice', available: false, transport: 'unsupported', auth: null, operatorApiCost: false, reason: 'No qualifying official subscription-backed transport' },
  ] });
});
it.each(['owner', 'manager', 'operator'])('retains generation connection and storage controls for %s', async role => {
  session.mockResolvedValue({ user: { role } });
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('Own account connection controls');
  expect(html).toContain('Storage credential controls');
  expect(html).toContain('Conecta tu cuenta de Grok');
  expect(html).toContain('Capacidades de transporte del proveedor');
  expect(html).toContain('Transporte local de vLLM');
  expect(html).toContain('Venice');
  expect(html).toContain('No hay un transporte oficial compatible basado en suscripción.');
  expect(workspaceDestinationAllowed(role, '/connections/grok')).toBe(true);
});
it('shows Creator own-account connection and private storage controls', async () => {
  session.mockResolvedValue({ user: { role: 'content_creator' } });
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('Own account connection controls');
  expect(html).toContain('Storage credential controls');
  expect(html).toContain('El almacenamiento es privado para tu cuenta');
  expect(html).toContain('Capacidades de transporte del proveedor');
});
it('shows an unavailable capability state when the gateway cannot be read', async () => {
  session.mockResolvedValue({ user: { role: 'owner' } });
  providers.mockRejectedValue(new Error('private gateway diagnostic'));
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('Estado de capacidades no disponible.');
  expect(html).not.toContain('private gateway diagnostic');
});
it.each(['chatter', 'model', 'analyst', 'agent', 'unknown', undefined])('denies direct page controls and navigation for %s', async role => {
  session.mockResolvedValue({ user: { role } });
  const html = renderToStaticMarkup(await Page());
  expect(html).not.toContain('Own account connection controls');
  expect(html).not.toContain('Storage credential controls');
  expect(html).toContain('Volver al espacio de trabajo');
  expect(providers).not.toHaveBeenCalled();
  expect(workspaceDestinationAllowed(role, '/connections/grok')).toBe(false);
});
