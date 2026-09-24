import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const state = vi.hoisted(() => ({
  role: 'owner',
  liveness: vi.fn(),
  readiness: vi.fn(),
  list: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  getSession: async () => ({ user: { role: state.role } }),
  api: {
    health: { liveness: state.liveness, readiness: state.readiness },
    models: { list: state.list },
  },
}));
vi.mock('@/lib/server-locale', () => ({
  getServerLocale: async () => ({ t: (key: string) => ({
    'layout.systemHealth': 'System health',
    'health.title': 'System health overview',
    'health.description': 'Live API and database status.',
    'health.services': 'Core services',
    'health.apiLiveness': 'API process',
    'health.databaseReadiness': 'PostgreSQL readiness',
    'health.available': 'Available',
    'health.unavailable': 'Unavailable',
    'health.apiLivenessDetails': 'Liveness only.',
    'health.databaseDetails': 'PostgreSQL readiness probe.',
    'health.incidentsLink': 'Incident recovery',
    'health.metricsLink': 'Prometheus metrics',
    'health.networkEgress': 'Per-profile egress',
    'health.networkEgressDescription': 'Manual tenant-scoped checks.',
    'health.modelsUnavailable': 'Profiles could not be loaded.',
    'health.noModels': 'No profiles on this page.',
    'health.openNetworkSettings': 'Network settings',
    'health.nextProfiles': 'Next profiles',
  }[key] ?? key) }),
}));
vi.mock('@/components/NetworkHealth', () => ({
  default: ({ modelId }: { modelId: string }) => <div>Network health controls for {modelId}</div>,
}));

import HealthPage from './page';

beforeEach(() => {
  state.role = 'owner';
  state.liveness.mockReset().mockResolvedValue({ status: 'ok', version: '0.1.0' });
  state.readiness.mockReset().mockResolvedValue({ status: 'ok', dependencies: { postgres: 'ok' } });
  state.list.mockReset().mockResolvedValue({ data: [{ id: 'model-1', displayName: 'Creator One' }], meta: { next_cursor: null } });
});

it('wires live/readiness probes, per-profile egress controls, incidents, and metrics', async () => {
  const html = renderToStaticMarkup(await HealthPage({}));
  expect(state.liveness).toHaveBeenCalledOnce();
  expect(state.readiness).toHaveBeenCalledOnce();
  expect(state.list).toHaveBeenCalledWith(undefined);
  expect(html).toContain('API process');
  expect(html).toContain('PostgreSQL readiness');
  expect(html).toContain('Network health controls for model-1');
  expect(html).toContain('href="/models/model-1/network"');
  expect(html).toContain('href="/incidents"');
  expect(html).toContain('href="/api/v1/metrics"');
});

it('reports failed checks as unavailable without exposing service errors', async () => {
  state.liveness.mockRejectedValue(new Error('private API detail'));
  state.readiness.mockRejectedValue(new Error('private DB detail'));
  const html = renderToStaticMarkup(await HealthPage({}));
  expect(html.match(/Unavailable/g)).toHaveLength(2);
  expect(html).not.toContain('private API detail');
  expect(html).not.toContain('private DB detail');
});

it('limits per-profile egress controls to owners', async () => {
  state.role = 'analyst';
  const html = renderToStaticMarkup(await HealthPage({}));
  expect(state.list).not.toHaveBeenCalled();
  expect(html).not.toContain('Per-profile egress');
  expect(html).not.toContain('Network health controls');
});

it('preserves the opaque cursor when listing more profiles', async () => {
  state.list.mockResolvedValue({
    data: [{ id: 'model-2', displayName: 'Creator Two' }],
    meta: { next_cursor: 'opaque + cursor' },
  });
  const html = renderToStaticMarkup(await HealthPage({}));
  expect(html).toContain('href="/health?modelCursor=opaque%20%2B%20cursor"');
});

it('keeps service status visible when the owner profile list is unavailable', async () => {
  state.list.mockRejectedValue(new Error('private model detail'));
  const html = renderToStaticMarkup(await HealthPage({}));
  expect(html).toContain('API process');
  expect(html).toContain('Profiles could not be loaded.');
  expect(html).not.toContain('private model detail');
});
