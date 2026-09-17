import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const mocks = vi.hoisted(() => ({ session: vi.fn(), accounts: vi.fn(), inbox: vi.fn() }));
vi.mock('@/lib/api', () => ({ getSession: mocks.session, api: { models: { inboxAccounts: mocks.accounts, inbox: mocks.inbox } } }));
import Page from './page';
const user = '11111111-1111-4111-8111-111111111111';
const render = async (query: Record<string, string | string[] | undefined> = {}) => renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'talent' }), searchParams: Promise.resolve(query) }));
beforeEach(() => {
  vi.clearAllMocks();
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
