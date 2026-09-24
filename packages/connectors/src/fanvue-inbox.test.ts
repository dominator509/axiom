import { expect, it, vi } from 'vitest';
import { FanvueConnector } from './fanvue.js';
import { parseChatPage, parseMessagePage } from './fanvue-inbox.js';
const user = '11111111-1111-4111-8111-111111111111';
const creator = '22222222-2222-4222-8222-222222222222';
function chat() {
  return { createdAt: null, lastMessageAt: null, isRead: false, isMuted: false,
    unreadMessagesCount: 0, user: { uuid: user, handle: 'fan', displayName: 'Fan', nickname: null, isTopSpender: false }, lastMessage: null };
}
function message() {
  return { uuid: user, text: null, sentAt: null, sender: { uuid: creator, handle: 'creator' }, recipient: { uuid: user, handle: 'fan' },
    hasMedia: true, mediaType: 'image', mediaUuids: [creator], mediaPreviewUuid: null, gif: null,
    type: 'SINGLE_RECIPIENT', pricing: { USD: { price: 1500 } }, purchasedAt: null, tipSource: null,
    sentByUserId: null, appUuid: null, isRead: false };
}
const envelope = (data: unknown[], page = 1) => ({ data, pagination: { page, size: data.length, hasMore: false } });
function transport(body: unknown) { return vi.fn(async () => new Response(JSON.stringify(body))); }

it('requests a bounded chat page through the injected transport', async () => {
  const fetcher = transport(envelope([chat()], 2));
  const result = await new FanvueConnector({ accessToken: 'fixture-token' }, fetcher).fetchChats(2, 10);
  const [url, init] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0];
  expect(url).toBe('https://api.fanvue.com/chats?page=2&size=10');
  expect(init.method).toBe('GET');
  expect(init.headers).toMatchObject({ 'X-Fanvue-API-Version': '2025-06-26', Authorization: 'Bearer fixture-token' });
  expect(result.data[0].isRead).toBe(false); // Manually unread may have zero unread messages.
  expect(result.data[0].unreadMessagesCount).toBe(0);
});
it('reads messages without marking them read and preserves payment/media semantics', async () => {
  const fetcher = transport(envelope([message()]));
  const result = await new FanvueConnector({ accessToken: 'fixture-token' }, fetcher).fetchChatMessages(user);
  const [url, init] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0];
  expect(url).toBe(`https://api.fanvue.com/chats/${user}/messages?page=1&size=25&markAsRead=false`);
  expect(init.method).toBe('GET');
  expect(result.data[0]).toMatchObject({ text: null, mediaUuids: [creator], pricing: { USD: { price: 1500 } }, purchasedAt: null });
});
it.each([[0, 25], [1, 51], [1.5, 10], [1, 0], [NaN, 10]])('rejects bad pagination before network (%s, %s)', async (page, size) => {
  const fetcher = transport({});
  const connector = new FanvueConnector({ accessToken: 'fixture-token' }, fetcher);
  await expect(connector.fetchChats(page, size)).rejects.toThrow('pagination');
  await expect(connector.fetchChatMessages(user, page, size)).rejects.toThrow('pagination');
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects a path-injection user before network', async () => {
  const fetcher = transport({});
  await expect(new FanvueConnector({ accessToken: 'fixture-token' }, fetcher).fetchChatMessages('../users/me')).rejects.toThrow('inbox user');
  expect(fetcher).not.toHaveBeenCalled();
});
it('discards unknown and third-party URL fields while retaining GIF identity', () => {
  const value = { ...message(), hasMedia: false, mediaUuids: [], pricing: null,
    gif: { id: 'gif-1', title: 'A wave', format: 'GIF', url: 'https://tracking.invalid/image', width: 100, height: 100 } };
  const result = parseMessagePage(envelope([value]), 1, 25);
  expect(result.data[0].gif).toEqual({ id: 'gif-1', title: 'A wave', format: 'GIF' });
  expect(JSON.stringify(result)).not.toContain('tracking.invalid');
});
it('accepts a genuine empty final page', () => {
  expect(parseChatPage(envelope([]), 1, 25).data).toEqual([]);
  expect(parseMessagePage(envelope([]), 1, 25).data).toEqual([]);
});
it.each([null, {}, { data: [], pagination: { page: 1 } }, envelope([chat()], 2)])('rejects malformed or mismatched chat pages', value => {
  expect(() => parseChatPage(value, 1, 25)).toThrow('response contract');
});
it('rejects oversized pages instead of silently dropping messages', () => {
  expect(() => parseChatPage(envelope([chat(), chat()]), 1, 1)).toThrow('response contract');
  expect(() => parseMessagePage(envelope([message(), message()]), 1, 1)).toThrow('response contract');
});
it('rejects malformed pricing rather than implying free content', () => {
  expect(() => parseMessagePage(envelope([{ ...message(), pricing: { USD: { price: '1500' } } }]), 1, 25)).toThrow('response contract');
});
it('does not convert upstream access failure into an empty inbox', async () => {
  const fetcher = vi.fn(async () => new Response('', { status: 403 }));
  await expect(new FanvueConnector({ accessToken: 'fixture-token' }, fetcher).fetchChats()).rejects.toThrow('403');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
