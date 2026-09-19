import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, LocaleCatalog } from '@axiom/core';
const mocks = vi.hoisted(() => ({ session: vi.fn(), accounts: vi.fn(), earnings: vi.fn(), locale: 'en' }));
vi.mock('@/lib/api', () => ({ getSession: mocks.session, api: { uiLocale: { get: async () => ({ data: { locale: mocks.locale } }) }, models: { earningsAccounts: mocks.accounts, earnings: mocks.earnings } } }));
import Page from './page';
const catalog = new LocaleCatalog(CATALOGS);
const render = async (connectionId?: string | string[]) => renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'talent' }), searchParams: Promise.resolve({ connectionId }) }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = 'en';
  mocks.session.mockResolvedValue({ user: { role: 'owner' } });
  mocks.accounts.mockResolvedValue({ data: { accounts: [{ id: 'account', displayName: 'My Fanvue' }] } });
  mocks.earnings.mockResolvedValue({ data: { connectionId: 'account', observedAt: '2026-09-17T00:00:00Z', currency: 'USD', unit: 'cents', summary: {
    totals: { allTime: { gross: 12345, net: 9876 }, thisMonth: { gross: 0, net: 0, previousMonthGross: 0, previousMonthNet: 0, grossChangePercentage: null, netChangePercentage: 0 } },
    breakdownBySource: { tips: { gross: 0, net: 0 } }, overTime: [],
    period: { startDate: null, endDate: null, granularity: 'day', timezone: 'UTC' },
  } } });
});
it.each(['operator', 'analyst', 'agent', 'chatter', 'content_creator', undefined])('does not request financial data for %s', async role => {
  mocks.session.mockResolvedValue({ user: { role } });
  expect(await render()).toContain('Earnings access unavailable');
  expect(mocks.accounts).not.toHaveBeenCalled();
  expect(mocks.earnings).not.toHaveBeenCalled();
});
it.each(['owner', 'manager', 'model'])('offers explicit account choice for %s without an automatic read', async role => {
  mocks.session.mockResolvedValue({ user: { role } });
  const html = await render();
  expect(html).toContain('for="earnings-account"');
  expect(html).toContain('My Fanvue');
  expect(html).toContain('method="get"');
  expect(mocks.earnings).not.toHaveBeenCalled();
});
it('renders cents as dollars, preserves zero/null and discloses reversal/payout limits', async () => {
  const html = await render('account');
  expect(mocks.earnings).toHaveBeenCalledWith('talent', 'account');
  for (const text of ['$123.45', '$98.76', '$0.00', 'Not comparable', '0.0%', 'Neither subtracts refunds or chargebacks', 'not your withdrawable balance', 'No timeline observations', 'Refresh earnings']) expect(html).toContain(text);
});
it('does not contact a foreign or malformed selection', async () => {
  expect(await render('foreign-account')).toContain('no longer available');
  await render(['account', 'foreign-account']);
  expect(mocks.earnings).not.toHaveBeenCalled();
});
it('does not show zero earnings or admin links for an unconnected model', async () => {
  mocks.session.mockResolvedValue({ user: { role: 'model' } });
  mocks.accounts.mockResolvedValue({ data: { accounts: [] } });
  const html = await render();
  expect(html).toContain('unavailable, not zero');
  expect(html).not.toContain('Open talent profile');
  expect(html).not.toContain('$0.00');
});
it('keeps a failed provider read retryable without leaking errors or showing invented totals', async () => {
  mocks.earnings.mockRejectedValue(new Error('sensitive-provider-detail'));
  const html = await render('account');
  expect(html).toContain('role="alert"');
  expect(html).toContain('Load earnings');
  expect(html).not.toContain('sensitive-provider-detail');
  expect(html).not.toContain('$0.00');
});
it('distinguishes failed account discovery from no account', async () => {
  mocks.accounts.mockRejectedValue(new Error('database-detail'));
  const html = await render('account');
  expect(html).toContain('accounts could not be loaded');
  expect(html).not.toContain('No connected Fanvue account');
  expect(mocks.earnings).not.toHaveBeenCalled();
});
it('uses the persisted interface locale for financial labels and formatting', async () => {
  mocks.locale = 'de';
  const html = await render('account');
  expect(html).toContain(catalog.t('de', 'earnings.title'));
  expect(html).toContain(catalog.t('de', 'earnings.gross'));
  expect(html).not.toContain(catalog.t('en', 'earnings.title'));
  expect(html).not.toContain('$123.45');
});
