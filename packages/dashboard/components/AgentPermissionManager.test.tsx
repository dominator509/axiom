import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AgentPermissionManager from './AgentPermissionManager';
import LocaleProvider from './LocaleProvider';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const permission = {
  id: 'permission-1', modelId: 'model-1', agentRef: 'grok-roleplayer', tier: 'operator',
  canPublish: false, canEdit: true, createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-01-01T00:00:00Z',
  tokens: [{ tokenId: 'token-1', expiresAt: '2030-01-01T00:15:00Z', revokedAt: null }],
};

it('localizes agent permissions while preserving agent references and token metadata', () => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale="es"><AgentPermissionManager modelId="model-1" permissions={[permission]} canEdit /></LocaleProvider>);
  expect(html).toContain('Las autorizaciones están vinculadas al modelo');
  expect(html).toContain('Conceder acceso a un agente');
  expect(html).toContain('Emitir token de 15 minutos');
  expect(html).toContain('operador');
  expect(html).toContain('publicación deshabilitada');
  expect(html).toContain('puede editar');
  expect(html).toContain('Tokens emitidos');
  expect(html).toContain('Revocar');
  expect(html).toContain('grok-roleplayer');
  expect(html).not.toContain('Issue 15-minute token');
});

it('localizes the read-only owner boundary and hides mutation controls', () => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale="de"><AgentPermissionManager modelId="model-1" permissions={[]} canEdit={false} /></LocaleProvider>);
  expect(html).toContain('Für dieses Modell gibt es keine Agentenfreigaben.');
  expect(html).toContain('Agentenfreigaben und Token-Ausstellung erfordern den Arbeitsbereichseigentümer.');
  expect(html).not.toContain('Agentenfreigabe speichern');
  expect(html).not.toContain('Issue 15-minute token');
});
