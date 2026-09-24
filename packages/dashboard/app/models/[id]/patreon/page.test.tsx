import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, LocaleCatalog } from '@axiom/core';

const state = vi.hoisted(() => ({ role: 'owner', locale: 'es' as const, accounts: [] as Array<Record<string, string>>, list: vi.fn() }));

vi.mock('@/lib/api', () => ({
  getSession: async () => ({ user: { role: state.role } }),
  api: { social: { list: state.list } },
}));
vi.mock('@/lib/server-locale', () => ({
  getServerLocale: async () => ({
    locale: state.locale,
    t: (key: string, values?: Record<string, string | number>) => catalog.t(state.locale, key, values),
  }),
}));
vi.mock('@/components/PatreonManager', () => ({ default: () => <div>patreon-manager</div> }));

import PatreonPage from './page';

const catalog = new LocaleCatalog(CATALOGS);

beforeEach(() => {
  state.role = 'owner';
  state.locale = 'es';
  state.accounts = [];
  state.list.mockReset().mockResolvedValue({ data: state.accounts });
});

it('localizes the disconnected Patreon onboarding surface', async () => {
  const html = renderToStaticMarkup(await PatreonPage({ params: Promise.resolve({ id: 'model-1' }) }));
  expect(html).toContain(catalog.t('es', 'patreon.title'));
  expect(html).toContain(catalog.t('es', 'patreon.scopeDescription'));
  expect(html).toContain(catalog.t('es', 'patreon.connectAction'));
  expect(html).not.toContain(catalog.t('en', 'patreon.title'));
});

it('keeps Patreon connection onboarding role-gated', async () => {
  state.role = 'viewer';
  const html = renderToStaticMarkup(await PatreonPage({ params: Promise.resolve({ id: 'model-1' }) }));
  expect(html).toContain(catalog.t('es', 'patreon.connectRequiresRole'));
  expect(html).not.toContain('api/v1/connectors/patreon/authorize');
});

it('renders the connected manager without changing the provider contract', async () => {
  state.accounts = [{ id: 'connection-1', platform: 'patreon', displayName: 'Creator Patreon', status: 'active' }];
  state.list.mockResolvedValue({ data: state.accounts });
  const html = renderToStaticMarkup(await PatreonPage({ params: Promise.resolve({ id: 'model-1' }) }));
  expect(html).toContain('Creator Patreon');
  expect(html).toContain('patreon-manager');
  expect(state.list).toHaveBeenCalledWith('model-1');
});
