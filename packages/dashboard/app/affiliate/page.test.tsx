import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, LocaleCatalog } from '@axiom/core';

const state = vi.hoisted(() => ({ role: 'owner', locale: 'en', load: vi.fn() }));

vi.mock('@/lib/api', () => ({
  getSession: async () => ({ user: { role: state.role } }),
  api: {
    uiLocale: { get: async () => ({ data: { locale: state.locale } }) },
    platformAffiliate: { getProgram: state.load },
  },
}));
vi.mock('@/components/PlatformAffiliateManager', () => ({ default: () => <div>affiliate-manager</div> }));

import AffiliatePage from './page';

const catalog = new LocaleCatalog(CATALOGS);

beforeEach(() => {
  state.role = 'owner';
  state.locale = 'en';
  state.load.mockReset().mockResolvedValue({ data: { program: {}, partners: [], campaigns: [], holds: [], summary: {} } });
});

it('keeps the affiliate manager owner-only', async () => {
  state.role = 'viewer';
  const html = renderToStaticMarkup(await AffiliatePage());
  expect(html).toContain(catalog.t('en', 'affiliate.accessTitle'));
  expect(html).toContain(catalog.t('en', 'affiliate.accessDescription'));
  expect(html).not.toContain('affiliate-manager');
  expect(state.load).not.toHaveBeenCalled();
});

it('uses the persisted locale for access and loading failures', async () => {
  state.role = 'viewer';
  state.locale = 'de';
  const denied = renderToStaticMarkup(await AffiliatePage());
  expect(denied).toContain(catalog.t('de', 'affiliate.accessTitle'));
  expect(denied).not.toContain(catalog.t('en', 'affiliate.accessTitle'));

  state.role = 'owner';
  state.load.mockRejectedValue(new Error('private provider detail'));
  const failed = renderToStaticMarkup(await AffiliatePage());
  expect(failed).toContain(catalog.t('de', 'affiliate.loadFailed'));
  expect(failed).not.toContain('private provider detail');
});

it('renders the manager for an owner after a confirmed program read', async () => {
  const html = renderToStaticMarkup(await AffiliatePage());
  expect(html).toContain('affiliate-manager');
  expect(state.load).toHaveBeenCalledOnce();
});
