import { expect, it, vi } from 'vitest';
import { fetchFanvuePreview, previewRange } from './fanvue-media-preview.js';
import { FanvueConnector } from './fanvue.js';
const user = '11111111-1111-4111-8111-111111111111';
const message = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const media = (url = 'https://media.fanvue.com/private/video?signature=secret') => ({ results: {
  [id]: { uuid: id, messageUuid: message, ownerUuid: user, mediaType: 'video' as const,
    created_at: null, sentAt: null, name: null, variants: [{ variantType: 'main' as const, displayPosition: 0,
      url, width: 720, height: 1280, lengthMs: 6000 }] },
}, errors: [] });
const chunk = () => new Response(new Uint8Array([1, 2]), { status: 206,
  headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-1/100', 'Content-Length': '2' } });

it('bounds open/large ranges and accepts Safari two-byte probes', () => {
  expect(previewRange('bytes=0-1')?.header).toBe('bytes=0-1');
  expect(previewRange('bytes=100-')?.header).toBe('bytes=100-8388707');
  expect(previewRange()).toBeNull();
});
it.each(['bytes=-100', 'bytes=9-1', 'bytes=0-1,3-4', 'bytes=1610612736-', 'bytes=0-9999999999', 'bytes=0-1\r\nX: y'])('rejects invalid range %s', range => {
  expect(() => previewRange(range)).toThrow('Invalid preview range');
});
it('resolves the exact message then fetches credential-free bytes through the same transport', async () => {
  const transport = vi.fn().mockResolvedValueOnce(Response.json(media())).mockResolvedValueOnce(chunk());
  const connector = new FanvueConnector({ accessToken: 'private-token' }, transport);
  const result = await connector.fetchMessagePreview(user, message, id, 'main', 'bytes=0-1');
  expect(result.status).toBe(206); expect([...result.bytes]).toEqual([1, 2]);
  expect(transport).toHaveBeenCalledTimes(2);
  expect(transport.mock.calls[0][0]).toContain(`/chats/${user}/messages/${message}/media?`);
  const request = transport.mock.calls[1][1];
  expect(request).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'manual', headers: { Range: 'bytes=0-1' } });
  expect(JSON.stringify(request)).not.toMatch(/private-token|Authorization|Cookie/);
});
it.each(['http://media.fanvue.com/x', 'https://127.0.0.1/x', 'https://media.fanvue.com.evil.invalid/x',
  'https://media.fanvue.com:8443/x', 'https://user:secret@media.fanvue.com/x', 'https://api.fanvue.com/x'])('rejects unapproved target before byte fetch %s', async url => {
  const transport = vi.fn();
  await expect(fetchFanvuePreview(media(url), id, 'main', transport)).rejects.toThrow('Preview unavailable');
  expect(transport).not.toHaveBeenCalled();
});
const invalidResponses: ResponseInit[] = [
  { status: 302, headers: { Location: 'https://127.0.0.1/' } },
  { status: 200, headers: { 'Content-Type': 'text/html' } },
  { status: 200, headers: { 'Content-Type': 'video/mp4', 'Content-Length': '16777217' } },
  { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 1-2/100' } },
  { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-3/100' } },
  { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-1/1' } },
  { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-1/100', 'Content-Encoding': 'gzip' } },
];
it.each(invalidResponses)('rejects redirect, unsafe MIME, size and range mismatches %#', async init => {
  const transport = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2]), init));
  await expect(fetchFanvuePreview(media(), id, 'main', transport, 'bytes=0-1')).rejects.toThrow('Preview unavailable');
  expect(transport).toHaveBeenCalledOnce();
});
it('rejects truncated range bodies and bounds actual streamed bytes without trusting Content-Length', async () => {
  const short = vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), { status: 206,
    headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-1/100' } }));
  await expect(fetchFanvuePreview(media(), id, 'main', short, 'bytes=0-1')).rejects.toThrow('Preview unavailable');
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
  const huge = vi.fn().mockResolvedValue(new Response(stream, { headers: { 'Content-Type': 'video/mp4' } }));
  await expect(fetchFanvuePreview(media(), id, 'main', huge)).rejects.toThrow('Preview unavailable');
  expect(cancelled).toBe(true);
});
it('sanitizes errors containing signed URLs and refuses missing variants', async () => {
  const transport = vi.fn().mockRejectedValue(new Error('https://media.fanvue.com/x?signature=secret'));
  await expect(fetchFanvuePreview(media(), id, 'main', transport)).rejects.toThrow(/^Preview unavailable$/);
  transport.mockClear();
  await expect(fetchFanvuePreview(media(), id, 'thumbnail', transport)).rejects.toThrow('Preview unavailable');
  expect(transport).not.toHaveBeenCalled();
});
