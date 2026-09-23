import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, LocaleCatalog, type SupportedLocale } from '@axiom/core';
import { api, getSession } from '@/lib/api';
import { getServerLocale } from '@/lib/server-locale';
import NetworkPage from './page';
const catalog = new LocaleCatalog(CATALOGS);
vi.mock('@/lib/api', () => ({
  getSession: vi.fn(),
  api: { models: { network: vi.fn() }, social: { list: vi.fn() } },
}));
vi.mock('@/lib/server-locale', () => ({ getServerLocale: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const localeFor = (locale: SupportedLocale): Awaited<ReturnType<typeof getServerLocale>> => ({
  locale,
  t: (key, values) => catalog.t(locale, key, values),
  dateTime: (value) => String(value),
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getServerLocale).mockResolvedValue(localeFor('en'));
  vi.mocked(getSession).mockResolvedValue({ user: { id: 'user', role: 'owner' } });
  vi.mocked(api.models.network).mockResolvedValue({
    data: {
      modelId: 'model',
      egressMode: null,
      healthy: false,
      lastCheck: null,
      latencyMs: null,
      lastEgressIp: null,
      failCount: 0,
      lastError: null,
    },
  });
  vi.mocked(api.social.list).mockResolvedValue({ data: [] });
});
const render = async (searchParams?: { oauth?: string; platform?: string }) =>
  renderToStaticMarkup(
    await NetworkPage({
      params: Promise.resolve({ id: 'model' }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
it('offers activation only after a saved configuration exists', async () => {
  expect(await render()).not.toContain('Apply saved connection');
  vi.mocked(api.models.network).mockResolvedValue({
    data: {
      id: 'config',
      modelId: 'model',
      egressMode: 'socks5',
      healthy: false,
      lastCheck: null,
      latencyMs: null,
      lastEgressIp: null,
      failCount: 0,
      lastError: null,
    },
  });
  const html = await render();
  expect(html).toContain('Apply saved connection');
  expect(html).toContain('I approve applying');
});
it('exposes provider OAuth entry points only to operational roles', async () => {
  const html = await render();
  for (const platform of ['fanvue', 'threads', 'tiktok', 'x', 'youtube', 'reddit', 'instagram', 'facebook', 'discord']) {
    expect(html).toContain(`/api/v1/connectors/${platform}/authorize?modelId=model`);
  }
  expect(html).toContain('<h3>Snapchat</h3>');
  expect(html).toContain('<h3>Telegram</h3>');
  vi.mocked(getSession).mockResolvedValue({ user: { id: 'user', role: 'viewer' } });
  const readonly = await render();
  expect(readonly).not.toContain('/api/v1/connectors/fanvue/authorize');
  expect(readonly).not.toContain('/api/v1/connectors/tiktok/authorize');
  expect(readonly).not.toContain('/api/v1/connectors/snapchat/manual');
  expect(readonly).toContain('Connecting accounts requires an owner, manager or operator role.');
});
it('confirms a successful browser OAuth return without trusting arbitrary query text', async () => {
  expect(await render({ oauth: 'connected', platform: 'fanvue' })).toContain(catalog.t('en', 'network.oauthSuccess', { platform: 'Fanvue' }));
  expect(await render({ oauth: 'connected', platform: 'unknown' })).not.toContain(
    'connected successfully',
  );
});
it.each(['es', 'ja', 'it', 'pt-BR', 'de'] as SupportedLocale[])('renders mounted network copy in %s', async (locale) => {
  vi.mocked(getServerLocale).mockResolvedValue(localeFor(locale));
  const html = await render();
  expect(html).toContain(catalog.t(locale, 'model.networkSecurity'));
  expect(html).toContain(catalog.t(locale, 'network.socialConnections'));
  expect(html).not.toContain(catalog.t('en', 'network.socialConnections'));
});
it('lets an owner configure a successfully loaded unconfigured model', async () => {
  const html = await render();
  expect(html).toContain('Not configured');
  expect(html).toContain('Save network config');
});
it.each(['operator', 'manager', 'viewer'])('does not offer owner controls to %s', async (role) => {
  vi.mocked(getSession).mockResolvedValue({ user: { id: 'user', role } });
  const html = await render();
  expect(api.models.network).not.toHaveBeenCalled();
  expect(html).toContain('Only a workspace owner');
  expect(html).not.toContain('Save network config');
  expect(html).toContain('Connected accounts');
});
it('does not treat load failure as a fresh editable configuration', async () => {
  vi.mocked(api.models.network).mockRejectedValue(new Error('Unavailable'));
  const html = await render();
  expect(html).toContain('Network configuration could not be loaded');
  expect(html).not.toContain('Save network config');
});
it('does not render raw network errors', async () => {
  const rawError = 'postgres://secret-user:secret-password@db/internal failure';
  vi.mocked(api.models.network).mockResolvedValue({
    data: {
      id: 'config', modelId: 'model', egressMode: 'socks5', healthy: false,
      lastCheck: null, latencyMs: null, lastEgressIp: null, failCount: 1, lastError: rawError,
    },
  });
  const html = await render();
  expect(html).toContain(catalog.t('en', 'network.lastCheckFailed'));
  expect(html).not.toContain(rawError);
  expect(html).not.toContain('secret-password');
});
it('distinguishes account load failures from successful empty lists', async () => {
  vi.mocked(api.social.list).mockRejectedValue(new Error('Unavailable'));
  const html = await render();
  expect(html).toContain('Connected accounts could not be loaded');
  expect(html).not.toContain('No platform accounts connected.');
});
it('localizes connected-account headings while preserving provider data', async () => {
  vi.mocked(api.social.list).mockResolvedValue({ data: [{ id: 'a1', modelId: 'model', platform: 'fanvue', displayName: 'DJ', status: 'connected', capabilities: ['read'], connectedAt: '2026-01-01T00:00:00Z' }] });
  vi.mocked(getServerLocale).mockResolvedValue(localeFor('de'));
  const html = await render();
  expect(html).toContain(catalog.t('de', 'network.platform'));
  expect(html).toContain(catalog.t('de', 'network.capabilities'));
  expect(html).toContain('fanvue');
  expect(html).toContain('DJ');
});
it('shows a refresh action for connected accounts with a refresh-token flow', async () => {
  vi.mocked(api.social.list).mockResolvedValue({ data: [{
    id: 'x-connection', modelId: 'model', platform: 'fanvue', displayName: '@creator', status: 'connected',
    capabilities: ['publish'], connectedAt: '2026-01-01T00:00:00Z',
  }] });
  const html = await render();
  expect(html).toContain('Refresh access');
});

it('shows the same refresh action for a Snapchat OAuth connection but not a manual handoff', async () => {
  vi.mocked(api.social.list).mockResolvedValue({ data: [{
    id: 'snap-connection', modelId: 'model', platform: 'snapchat', displayName: '@creator', status: 'connected',
    capabilities: ['publish'], connectedAt: '2026-01-01T00:00:00Z',
  }] });
  expect(await render()).toContain('Refresh access');
});

it('labels Snapchat manual-assist connections and does not offer OAuth refresh for them', async () => {
  vi.mocked(api.social.list).mockResolvedValue({ data: [{
    id: 'snap-manual', modelId: 'model', platform: 'snapchat', displayName: '@creator', status: 'connected',
    capabilities: ['publish', 'publish.manual_assist'], connectedAt: '2026-01-01T00:00:00Z',
  }] });
  const html = await render();
  expect(html).toContain('Manual assist');
  expect(html).not.toContain('Refresh access');
});
it('formats network latency with the selected locale', async () => {
  vi.mocked(getServerLocale).mockResolvedValue(localeFor('de'));
  vi.mocked(api.models.network).mockResolvedValue({
    data: {
      id: 'config', modelId: 'model', egressMode: 'socks5', healthy: true,
      lastCheck: '2026-01-01T00:00:00Z', latencyMs: 1234, lastEgressIp: '203.0.113.10',
      failCount: 0, lastError: null,
    },
  });
  const html = await render();
  expect(html).toContain('1.234 ms');
  expect(html).toContain(catalog.t('de', 'network.lastChecked'));
  expect(html).toContain(catalog.t('de', 'network.failureCount'));
});
