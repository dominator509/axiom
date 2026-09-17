import { expect, it, vi } from 'vitest';
import { FanvueConnector } from './fanvue.js';
import { messageMediaQuery, parseMessageMedia } from './fanvue-message-media.js';
const user = '11111111-1111-4111-8111-111111111111';
const message = '22222222-2222-4222-8222-222222222222';
const media = '33333333-3333-4333-8333-333333333333';
const other = '44444444-4444-4444-8444-444444444444';
const item = () => ({ uuid: media, messageUuid: message, ownerUuid: user, mediaType: 'image', created_at: null, sentAt: null, name: null,
  variants: [{ variantType: 'main', displayPosition: 0, url: 'https://media.fanvue.com/image?signature=fixture', width: 100, height: 200, lengthMs: null }],
  pricing: { USD: { price: 1000 } }, amountPaid: { USD: { price: 700 } }, purchasedAt: '2026-09-17' });
const envelope = () => ({ results: { [media]: item() }, errors: [] });
it('resolves only the selected message attachments using the versioned authenticated transport', async () => {
  const fetcher = vi.fn(async () => Response.json(envelope()));
  const response = await new FanvueConnector({ accessToken: 'fixture' }, fetcher).fetchMessageMedia(user, message, [media]);
  const [url, init] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0];
  expect(url).toBe(`https://api.fanvue.com/chats/${user}/messages/${message}/media?mediaUuids=${media}`);
  expect(init.method).toBe('GET');
  expect(init.headers).toMatchObject({ Authorization: 'Bearer fixture', 'X-Fanvue-API-Version': '2025-06-26' });
  expect(response.results[media]?.amountPaid).toEqual({ USD: { price: 700 } });
  expect(fetcher).toHaveBeenCalledOnce();
});
it.each([[], [media, media], ['../media'], Array(21).fill(media)])('rejects invalid media selection before network %#', async selection => {
  const fetcher = vi.fn();
  await expect(new FanvueConnector({ accessToken: 'fixture' }, fetcher).fetchMessageMedia(user, message, selection)).rejects.toThrow('selection');
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([['../users', message], [user, '../messages']])('rejects injected path segments', (selectedUser, selectedMessage) => {
  expect(() => messageMediaQuery(selectedUser, selectedMessage, [media])).toThrow('selection');
});
it.each(['uuid', 'messageUuid'])('rejects a substituted %s', key => {
  const value = envelope(); Object.assign(value.results[media], { [key]: other });
  expect(() => parseMessageMedia(value, message, [media])).toThrow('response contract');
});
it('rejects unsolicited media and missing result coverage', () => {
  expect(() => parseMessageMedia(envelope(), message, [other])).toThrow('response contract');
  expect(() => parseMessageMedia({ results: {}, errors: [] }, message, [media])).toThrow('response contract');
});
it('preserves unavailable items without exposing provider error messages', () => {
  expect(parseMessageMedia({ results: { [media]: null }, errors: [{ mediaUuid: media, code: 'NOT_IN_MESSAGE', message: 'internal signed URL' }] }, message, [media]))
    .toEqual({ results: { [media]: null }, errors: [{ mediaUuid: media, code: 'NOT_IN_MESSAGE' }] });
});
it('accepts absent variants and URLs without inventing a preview', () => {
  const value = envelope();
  const { variants: _variants, ...metadata } = value.results[media];
  expect(_variants).toHaveLength(1);
  expect(parseMessageMedia({ results: { [media]: metadata }, errors: [] }, message, [media]).results[media]?.variants).toBeUndefined();
  const { url: _url, ...variant } = value.results[media].variants[0];
  expect(_url).toContain('https://media.fanvue.com/');
  expect(parseMessageMedia({ results: { [media]: { ...metadata, variants: [variant] } }, errors: [] }, message, [media]).results[media]?.variants?.[0].url).toBeUndefined();
});
it.each(['http://media.fanvue.com/x', 'https://user:secret@media.fanvue.com/x', 'javascript:alert(1)', 'https://media.fanvue.com/x#fragment'])('rejects unsafe URL shape %s', url => {
  const value = envelope(); value.results[media].variants[0].url = url;
  expect(() => parseMessageMedia(value, message, [media])).toThrow('response contract');
});
it('rejects contradictory or duplicate per-item failures', () => {
  const error = { mediaUuid: media, code: 'INTERNAL' };
  expect(() => parseMessageMedia({ ...envelope(), errors: [error] }, message, [media])).toThrow('response contract');
  expect(() => parseMessageMedia({ results: { [media]: null }, errors: [error, error] }, message, [media])).toThrow('response contract');
});
it('does not convert an authorization failure into an empty result', async () => {
  const fetcher = vi.fn(async () => new Response('', { status: 403 }));
  await expect(new FanvueConnector({ accessToken: 'fixture' }, fetcher).fetchMessageMedia(user, message, [media])).rejects.toThrow('403');
  expect(fetcher).toHaveBeenCalledOnce();
});
