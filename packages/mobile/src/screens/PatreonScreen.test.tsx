import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, LocaleCatalog } from '@axiom/core';
import type {
  MobilePatreonStatus,
  PatreonResource,
} from '../api/endpoints';

vi.mock('../api/endpoints', () => ({
  getModels: async () => ({ data: [], meta: { total: 0, limit: 100, next_cursor: null } }),
  getPatreonData: async () => [],
  getPatreonStatus: async () => { throw new Error('not connected'); },
  getSocialConnections: async () => [],
  getUiLocale: async () => ({
    locale: 'en',
    source: 'user',
    userLocale: 'en',
    orgLocale: null,
    supportedLocales: ['en', 'es', 'ja', 'it', 'pt-BR', 'de'],
    canSetOrg: false,
  }),
  patreonAuthorizeUrl: (modelId: string) => `https://example.test/patreon/${modelId}`,
  syncPatreon: async (_connectionId: string, resource: PatreonResource) => ({ resource, count: 0, nextCursor: null, replay: false }),
}));

import PatreonScreen, { PatreonView, type PatreonScreenState } from './PatreonScreen';

const catalog = new LocaleCatalog(CATALOGS);
const noop = () => undefined;

const model = {
  id: 'model-1',
  displayName: 'D James',
  handle: 'd_james',
  avatarUrl: null,
  isActive: true,
};

const status: MobilePatreonStatus = {
  connection: {
    id: 'connection-1',
    modelId: model.id,
    platform: 'patreon',
    displayName: 'D James Community',
    capabilities: ['read'],
    status: 'connected',
    connectedAt: '2026-01-01T00:00:00.000Z',
  },
  counts: { campaigns: 12345, members: 2345, posts: 345 },
  sync: [
    { resource: 'campaign', nextCursor: null, lastSyncedAt: '2026-01-02T03:04:05.000Z', hasError: false },
    { resource: 'members', nextCursor: null, lastSyncedAt: null, hasError: false },
    { resource: 'posts', nextCursor: null, lastSyncedAt: null, hasError: false },
  ],
  hasWebhook: true,
  deniedActions: ['publish', 'dm'],
};

const baseState: PatreonScreenState = {
  models: [model],
  selectedModelId: model.id,
  modelsLoading: false,
  communityLoading: false,
  connectionId: status.connection.id,
  status,
  records: {
    campaign: [{ id: 'campaign-1', providerRef: 'camp…1234', title: 'Launch', detail: '12 patrons reported', updatedAt: '2026-01-02T03:04:05.000Z', isPublic: true }],
    members: [],
    posts: [],
  },
  error: null,
  actionMessage: null,
  busy: null,
};

function renderView(overrides: Partial<PatreonScreenState> = {}, managePatreon = true, locale: 'en' | 'es' | 'ja' | 'it' | 'pt-BR' | 'de' = 'en') {
  return renderToStaticMarkup(
    <PatreonView
      locale={locale}
      state={{ ...baseState, ...overrides }}
      managePatreon={managePatreon}
      onLoadModels={noop}
      onSelectModel={noop}
      onAuthorize={noop}
      onSync={noop}
    />,
  );
}

it('mounts the default Patreon screen in its truthful loading state', () => {
  const html = renderToStaticMarkup(<PatreonScreen user={{ id: 'u1', email: 'd.man@example.com', role: 'owner' } as never} />);
  expect(html).toContain(catalog.t('en', 'mobile.patreon.loadingModels'));
});

it('renders Patreon community controls in the selected Spanish locale', () => {
  const html = renderView({}, true, 'es');
  expect(html).toContain(catalog.t('es', 'mobile.patreon.subtitle'));
  expect(html).toContain(catalog.t('es', 'mobile.patreon.syncControls'));
  expect(html).toContain(catalog.t('es', 'mobile.patreon.campaigns'));
  expect(html).not.toContain(catalog.t('en', 'mobile.patreon.syncControls'));
});

it('formats Patreon counts and record dates with the selected Japanese locale', () => {
  const html = renderView({}, true, 'ja');
  expect(html).toContain(new Intl.NumberFormat('ja').format(12345));
  expect(html).toContain(new Intl.DateTimeFormat('ja', { timeZone: 'UTC' }).format(new Date('2026-01-02T03:04:05.000Z')));
});

it('keeps the unconnected viewer boundary visible without exposing connect controls', () => {
  const html = renderView({ connectionId: null, status: null }, false, 'de');
  expect(html).toContain(catalog.t('de', 'mobile.patreon.roleView'));
  expect(html).toContain(catalog.t('de', 'mobile.patreon.deniedActions'));
  expect(html).not.toContain(catalog.t('de', 'integration.patreon.connect'));
});

it('renders a localized empty model scope rather than fabricating community data', () => {
  const html = renderView({ models: [], selectedModelId: null }, true, 'it');
  expect(html).toContain(catalog.t('it', 'mobile.patreon.noModels'));
  expect(html).not.toContain('D James Community');
});
