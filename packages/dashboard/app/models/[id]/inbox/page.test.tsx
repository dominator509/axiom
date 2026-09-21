import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatNumber } from '@axiom/core';
const mocks = vi.hoisted(() => ({ session: vi.fn(), accounts: vi.fn(), inbox: vi.fn(), locale: vi.fn() }));
vi.mock('@/lib/api', () => ({ getSession: mocks.session, api: { models: { inboxAccounts: mocks.accounts, inbox: mocks.inbox } } }));
vi.mock('@/lib/server-locale', async () => {
  const core = await import('@axiom/core');
  const catalog = new core.LocaleCatalog(core.CATALOGS);
  return {
    getServerLocale: async () => {
      const locale = await mocks.locale();
      return {
        locale,
        t: (key: string, values?: Record<string, string | number>) => catalog.t(locale, key, values),
        dateTime: (value: string | Date) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
          .format(typeof value === 'string' ? new Date(value) : value),
      };
    },
  };
});
import Page from './page';
const user = '11111111-1111-4111-8111-111111111111';
const render = async (query: Record<string, string | string[] | undefined> = {}) => renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'talent' }), searchParams: Promise.resolve(query) }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale.mockResolvedValue('en');
  mocks.session.mockResolvedValue({ user: { role: 'chatter' } });
  mocks.accounts.mockResolvedValue({ data: { accounts: [{ id: 'account', displayName: 'Fanvue' }] } });
  mocks.inbox.mockResolvedValue({ data: { observedAt: '2026-09-17', inbox: { kind: 'chats', data: [{ user: { uuid: user, handle: 'fan', displayName: '<script>unsafe</script>', nickname: null }, isRead: false, unreadMessagesCount: 0, isMuted: true, lastMessage: null }], pagination: { page: 1, size: 1, hasMore: true } } } });
});
it.each(['content_creator', 'analyst', 'agent', undefined])('denies %s before queries', async role => {
  mocks.session.mockResolvedValue({ user: { role } });
  expect(await render()).toContain('Inbox access unavailable');
  expect(mocks.accounts).not.toHaveBeenCalled(); expect(mocks.inbox).not.toHaveBeenCalled();
});
it('requires explicit account selection before loading conversations', async () => {
  const html = await render();
  expect(html).toContain('for="inbox-account"'); expect(html).toContain('Load conversations');
  expect(mocks.inbox).not.toHaveBeenCalled();
  expect(html).not.toContain('Save reply without sending');
});
it.each(['owner', 'manager', 'operator', 'chatter', 'model'])('renders conversation reply controls appropriate for %s', async role => {
  mocks.session.mockResolvedValue({ user: { role } });
  mocks.inbox.mockResolvedValue({ data: { observedAt: 'today', inbox: { kind: 'messages', data: [], pagination: { page: 1, size: 0, hasMore: false } } } });
  const html = await render({ connectionId: 'account', userUuid: user });
  expect(html).toContain('Load reply history');
  expect(html.includes('Save reply without sending')).toBe(role !== 'model');
  expect(html).toContain('Nothing is sent when you save');
});
it('preserves unread state and escapes names while retaining account context in links', async () => {
  const html = await render({ connectionId: 'account' });
  expect(html).toContain('Unread · 0 unread messages'); expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>unsafe');
  expect(html).toContain(`userUuid=${user}`); expect(html).toContain('page=2');
  expect(html).toContain('does not mark it read');
});
it.each([{ page: '0' }, { page: 'abc' }, { userUuid: '../other' }, { connectionId: ['a', 'b'] }])('rejects invalid navigation without a provider read', async query => {
  await render({ connectionId: 'account', ...query }); expect(mocks.inbox).not.toHaveBeenCalled();
});
it('rejects accounts absent from current authorized choices', async () => {
  expect(await render({ connectionId: 'foreign' })).toContain('selected account is unavailable');
  expect(mocks.inbox).not.toHaveBeenCalled();
});
it('shows explicit permission/shift errors instead of an empty inbox', async () => {
  mocks.accounts.mockRejectedValue(new Error('private-details'));
  const html = await render(); expect(html).toContain('shift may have ended');
  expect(html).not.toContain('private-details'); expect(html).not.toContain('No connected');
});
it('preserves retry controls when provider retrieval fails', async () => {
  mocks.inbox.mockRejectedValue(new Error('provider-secret'));
  const html = await render({ connectionId: 'account' });
  expect(html).toContain('does not mean the inbox is empty'); expect(html).toContain('Load conversations');
  expect(html).not.toContain('provider-secret');
});
it('renders payment/media/GIF and author information without external image requests', async () => {
  mocks.inbox.mockResolvedValue({ data: { observedAt: 'today', inbox: { kind: 'messages', pagination: { page: 2, size: 1, hasMore: false }, data: [{ uuid: user, sender: { handle: 'creator' }, text: '<img src=x>', sentAt: null, type: 'SINGLE_RECIPIENT', isRead: false, hasMedia: true, mediaType: 'image', mediaUuids: [user], gif: { title: 'Wave' }, pricing: { USD: { price: 1500 } }, purchasedAt: null, tipSource: null, sentByUserId: user, appUuid: null }] } } });
  const html = await render({ connectionId: 'account', userUuid: user, page: '2' });
  expect(mocks.inbox).toHaveBeenCalledWith('talent', 'account', 2, user);
  for (const text of ['$15.00', 'No purchase recorded', 'Preview unavailable', 'GIF: Wave', 'Sent by team member', 'Previous page', 'Back to conversations']) expect(html).toContain(text);
  expect(html).not.toContain('<img'); expect(html).not.toContain('Next page');
});

it('formats message media counts through the selected locale', async () => {
  mocks.locale.mockResolvedValue('de');
  mocks.inbox.mockResolvedValue({ data: { observedAt: 'today', inbox: { kind: 'messages', pagination: { page: 1, size: 1, hasMore: false }, data: [{ uuid: user, sender: { handle: 'creator' }, text: 'media', sentAt: null, type: 'SINGLE_RECIPIENT', isRead: true, hasMedia: true, mediaType: 'image', mediaUuids: [user, '22222222-2222-4222-8222-222222222222'], gif: null, pricing: null, purchasedAt: null, tipSource: null, sentByUserId: null, appUuid: null }] } } });
  const html = await render({ connectionId: 'account', userUuid: user });
  expect(html).toContain(`${formatNumber(2, 'de')} Element`);
});

// ─── F-89 localization behavior ───
it.each([
  ['es', ['Bandeja', 'Cargar conversaciones', 'Cuenta de Fanvue']],
  ['ja', ['受信トレイ', '会話を読み込む', 'Fanvueアカウント']],
  ['it', ['Casella', 'Carica conversazioni', 'Account Fanvue']],
  ['pt-BR', ['Caixa de entrada', 'Carregar conversas', 'Conta Fanvue']],
  ['de', ['Posteingang', 'Konversationen laden', 'Fanvue-Konto']],
])('renders the inbox in %s rather than English', async (locale, expected) => {
  mocks.locale.mockResolvedValue(locale);
  const html = await render();
  for (const text of expected) expect(html).toContain(text);
  expect(html).not.toContain('Load conversations'); expect(html).not.toContain('Fanvue account');
});

it('localizes the access-denied surface for a non-English locale and keeps raw content untranslated', async () => {
  mocks.locale.mockResolvedValue('de');
  mocks.session.mockResolvedValue({ user: { role: 'analyst' } });
  const denied = await render();
  expect(denied).toContain('Posteingangszugriff nicht verfügbar');
  expect(denied).not.toContain('Inbox access unavailable');
  mocks.session.mockResolvedValue({ user: { role: 'chatter' } });
  const html = await render({ connectionId: 'account' });
  // User-authored content is data and is never translated.
  expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;');
});

it('formats the observation timestamp with the selected locale and UTC', async () => {
  mocks.inbox.mockResolvedValue({ data: { observedAt: '2026-09-17T15:30:00Z', inbox: { kind: 'chats', data: [], pagination: { page: 1, size: 0, hasMore: false } } } });
  mocks.locale.mockResolvedValue('de');
  const de = await render({ connectionId: 'account' });
  // German medium date keeps a dotted numeric day/month form; English does not.
  expect(de).toMatch(/17\.09\.2026|17\. Sept\. 2026/);
  mocks.locale.mockResolvedValue('en');
  const en = await render({ connectionId: 'account' });
  expect(en).toMatch(/Sep 17, 2026/);
  expect(en).not.toEqual(de);
});

it('preserves an explicit unavailable state for a malformed observation timestamp', async () => {
  mocks.inbox.mockResolvedValue({ data: { observedAt: 'not-a-date', inbox: { kind: 'chats', data: [], pagination: { page: 1, size: 0, hasMore: false } } } });
  const html = await render({ connectionId: 'account' });
  expect(html).toContain('Time unavailable');
  expect(html).not.toContain('Invalid Date');
});

it('formats pay-to-view currency with the selected locale', async () => {
  mocks.locale.mockResolvedValue('de');
  mocks.inbox.mockResolvedValue({ data: { observedAt: 'today', inbox: { kind: 'messages', pagination: { page: 1, size: 1, hasMore: false }, data: [{ uuid: user, sender: { handle: 'creator' }, text: null, sentAt: null, type: 'SINGLE_RECIPIENT', isRead: true, hasMedia: false, mediaType: null, mediaUuids: [], gif: null, pricing: { USD: { price: 123450 } }, purchasedAt: null, tipSource: null, sentByUserId: null, appUuid: null }] } } });
  const html = await render({ connectionId: 'account', userUuid: user });
  // German currency uses a comma decimal separator for USD.
  expect(html).toContain('1.234,50');
  expect(html).not.toContain('1,234.50');
});

it('keeps localized status text truthful for empty and unavailable states', async () => {
  mocks.locale.mockResolvedValue('es');
  mocks.inbox.mockResolvedValue({ data: { observedAt: '2026-09-17T00:00:00Z', inbox: { kind: 'messages', data: [], pagination: { page: 1, size: 0, hasMore: false } } } });
  const empty = await render({ connectionId: 'account', userUuid: user });
  expect(empty).toContain('No se devolvieron mensajes en esta página.');
  mocks.inbox.mockRejectedValue(new Error('provider-secret'));
  const failed = await render({ connectionId: 'account' });
  expect(failed).toContain('Esto no significa que la bandeja esté vacía.');
  expect(failed).not.toContain('provider-secret');
});
