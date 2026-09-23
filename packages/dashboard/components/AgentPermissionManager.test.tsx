import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AgentPermissionManager, { buildOpenClawSetupCommands, ERROR_MESSAGE_KEYS, TERMINAL_STATUSES, classifyStatus, errorText } from './AgentPermissionManager';
import LocaleProvider from './LocaleProvider';
import { CATALOGS, SUPPORTED_LOCALES, type MessageKey } from '@axiom/core';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const permission = {
  id: 'permission-1', modelId: 'model-1', agentRef: 'grok-roleplayer', tier: 'operator',
  canPublish: false, canEdit: true, createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-01-01T00:00:00Z',
  tokens: [{ tokenId: 'token-1', expiresAt: '2030-01-01T00:15:00Z', revokedAt: null }],
};

// A hostile backend message: control characters, markup and an injection attempt.
const HOSTILE_BACKEND_MESSAGE = '<img src=x onerror=alert(1)> INTERNAL STACK: secret-token-abc123';
const OPENCLAW_COPY_KEYS = [
  'agent.openclawTitle',
  'agent.openclawDescription',
  'agent.openclawEndpointLabel',
  'agent.openclawEndpointInvalid',
  'agent.openclawEnvironment',
  'agent.openclawCommandDescription',
  'agent.openclawExpiry',
] as const;

it('localizes agent permissions while preserving agent references and token metadata', () => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale="es"><AgentPermissionManager modelId="model-1" permissions={[permission]} canEdit /></LocaleProvider>);
  expect(html).toContain('Las autorizaciones están vinculadas al modelo');
  expect(html).toContain('Conceder acceso a un agente');
  expect(html).toContain('Emitir token de 15 minutos');
  expect(html).toContain('operador');
  expect(html).toContain('publicación deshabilitada');
  expect(html).toContain('puede editar');
  expect(html).toContain('Tokens emitidos');
  expect(html).toContain('Conectar OpenClaw');
  expect(html).toContain('AXIOM_MCP_TOKEN');
  expect(html).toContain('El token bearer caduca a los 15 minutos.');
  expect(html).toContain('Revocar');
  expect(html).toContain('grok-roleplayer');
  expect(html).toContain('2030');
  expect(html).not.toContain('T00:15:00.000Z');
  expect(html).not.toContain('Issue 15-minute token');
});

it('builds OpenClaw setup commands with a validated endpoint and environment token reference', () => {
  const commands = buildOpenClawSetupCommands('https://axiom.example.test');
  expect(commands).not.toBeNull();
  expect(commands).toContain('openclaw mcp doctor axiom --probe');
  expect(commands).toContain('https://axiom.example.test/api/mcp');
  expect(commands).toContain('Bearer ${AXIOM_MCP_TOKEN}');
  expect(commands).not.toContain('one-time-secret');

  const invalidOrigins = [
    'javascript:alert(1)',
    'https://user:password@axiom.example.test',
    'https://axiom.example.test/path',
    'https://axiom.example.test/?token=secret',
  ];
  for (const origin of invalidOrigins) expect(buildOpenClawSetupCommands(origin)).toBeNull();
});

it('provides localized OpenClaw setup guidance in every launch locale', () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const key of OPENCLAW_COPY_KEYS) {
      const value = CATALOGS[locale][key];
      expect(value, `${locale}:${key}`).toBeTypeOf('string');
      expect(value.trim(), `${locale}:${key}`).not.toBe('');
      if (locale !== 'en') expect(value, `${locale}:${key}`).not.toBe(CATALOGS.en[key]);
    }
  }
});

it('localizes the read-only owner boundary and hides mutation controls', () => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale="de"><AgentPermissionManager modelId="model-1" permissions={[]} canEdit={false} /></LocaleProvider>);
  expect(html).toContain('Für dieses Modell gibt es keine Agentenfreigaben.');
  expect(html).toContain('Agentenfreigaben und Token-Ausstellung erfordern den Arbeitsbereichseigentümer.');
  expect(html).not.toContain('Agentenfreigabe speichern');
  expect(html).not.toContain('Issue 15-minute token');
});

// ── error boundary: no backend message is ever rendered ──────────────────────

it('classifies every known non-success status into a bounded catalog-backed state', () => {
  expect(classifyStatus(400)).toEqual({ kind: 'invalid' });
  expect(classifyStatus(422)).toEqual({ kind: 'invalid' });
  expect(classifyStatus(401)).toEqual({ kind: 'denied' });
  expect(classifyStatus(403)).toEqual({ kind: 'denied' });
  expect(classifyStatus(404)).toEqual({ kind: 'notFound' });
  expect(classifyStatus(409)).toEqual({ kind: 'conflict' });
  expect(classifyStatus(500)).toEqual({ kind: 'notAccepted' });
  expect(classifyStatus(502)).toEqual({ kind: 'notAccepted' });
});

it('renders catalog-backed localized copy for a known non-success response, never the backend body', () => {
  const state = classifyStatus(403);
  const t = (key: string) => CATALOGS.es[key as MessageKey] ?? '';
  const rendered = errorText(state, t);
  expect(rendered).toBe(CATALOGS.es['agent.status.denied' as MessageKey]);
  expect(rendered).not.toContain(HOSTILE_BACKEND_MESSAGE);
  // The hostile backend string is not part of any catalog entry, so it cannot
  // appear in the rendered markup no matter what the server returned.
  const html = renderToStaticMarkup(<LocaleProvider initialLocale="es"><AgentPermissionManager modelId="model-1" permissions={[permission]} canEdit /></LocaleProvider>);
  expect(html).not.toContain(HOSTILE_BACKEND_MESSAGE);
  expect(html).not.toContain('secret-token-abc123');
});

it('renders catalog-backed localized copy for an uncertain failure and pairs it with the localized retry hint', () => {
  const t = (key: string) => CATALOGS.de[key as MessageKey] ?? '';
  const rendered = errorText({ kind: 'unconfirmed' }, t);
  expect(rendered).toBe(`${CATALOGS.de['agent.unconfirmed' as MessageKey]} ${CATALOGS.de['agent.retry' as MessageKey]}`);
  expect(rendered).not.toContain(HOSTILE_BACKEND_MESSAGE);
});

it('keeps local validation in the alert channel', () => {
  const t = (key: string) => CATALOGS.es[key as MessageKey] ?? '';
  expect(errorText({ kind: 'validation' }, t)).toBe(CATALOGS.es['agent.validationError' as MessageKey]);
});

it('keeps every error-boundary key translated, non-empty and non-English in every launch locale', () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const key of Object.values(ERROR_MESSAGE_KEYS)) {
      const value = CATALOGS[locale][key as MessageKey];
      expect(value, `${locale}:${key}`).toBeTypeOf('string');
      expect(value.trim(), `${locale}:${key}`).not.toBe('');
      if (locale !== 'en') {
        expect(value, `${locale}:${key} must not fall back to English`).not.toBe(CATALOGS.en[key as MessageKey]);
      }
    }
  }
});

it('retries only the uncertain intent: terminal statuses clear the held intent', () => {
  for (const status of TERMINAL_STATUSES) {
    expect(TERMINAL_STATUSES.includes(status)).toBe(true);
  }
  // A non-terminal status (e.g. 500/502/503) keeps the intent so retry remains available.
  expect((TERMINAL_STATUSES as readonly number[]).includes(500)).toBe(false);
  expect((TERMINAL_STATUSES as readonly number[]).includes(502)).toBe(false);
});
