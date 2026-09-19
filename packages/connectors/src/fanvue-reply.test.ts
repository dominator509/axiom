import { expect, it, vi } from 'vitest';
import { FanvueConnector } from './fanvue.js';
const user = '11111111-1111-4111-8111-111111111111';
const messageUuid = '22222222-2222-4222-8222-222222222222';
const auth = { accessToken: 'fixture-token' };
const allowFixtureDispatch = async () => {};
it('waits for the durable permission gate before the message request', async () => {
  const send = vi.fn(async () => Response.json({ messageUuid }, { status: 201 }));
  let release!: () => void;
  const gate = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  const pending = new FanvueConnector(auth, send).sendTextReply(user, 'Hello', gate);
  await vi.waitFor(() => expect(gate).toHaveBeenCalledOnce());
  expect(send).not.toHaveBeenCalled();
  release();
  await expect(pending).resolves.toEqual({ messageUuid });
  expect(send).toHaveBeenCalledOnce();
});
it('does not issue a message when the permission transaction fails', async () => {
  const send = vi.fn();
  await expect(new FanvueConnector(auth, send).sendTextReply(user, 'Hello', async () => { throw new Error('denied'); })).rejects.toThrow('denied');
  expect(send).not.toHaveBeenCalled();
});
it('does not claim dispatch when expired credentials cannot refresh', async () => {
  const send = vi.fn(), gate = vi.fn();
  await expect(new FanvueConnector({ ...auth, expiresAt: 1 }, send).sendTextReply(user, 'Hello', gate)).rejects.toThrow('expired');
  expect(send).not.toHaveBeenCalled(); expect(gate).not.toHaveBeenCalled();
});

it('sends exact approved text once and returns only the documented receipt', async () => {
  const send = vi.fn(async () => new Response(JSON.stringify({ messageUuid, unrelated: 'discard' }), { status: 201 }));
  const result = await new FanvueConnector(auth, send).sendTextReply(user, ' Hello\nthere! ', allowFixtureDispatch);
  expect(result).toEqual({ messageUuid }); expect(send).toHaveBeenCalledTimes(1);
  const [url, init] = (send.mock.calls as unknown as [string, RequestInit][])[0];
  expect(url).toBe(`https://api.fanvue.com/chats/${user}/message`);
  expect(init.method).toBe('POST'); expect(JSON.parse(init.body as string)).toEqual({ text: ' Hello\nthere! ' });
  expect(init.headers).toMatchObject({ Authorization: 'Bearer fixture-token', 'X-Fanvue-API-Version': '2025-06-26' });
  expect(init.headers).not.toHaveProperty('Idempotency-Key');
});
it.each(['', '   ', 'x'.repeat(5001)])('rejects invalid text before network', async text => {
  const send = vi.fn();
  await expect(new FanvueConnector(auth, send).sendTextReply(user, text, allowFixtureDispatch)).rejects.toThrow('1 to 5000');
  expect(send).not.toHaveBeenCalled();
});
it('rejects invalid recipient before network', async () => {
  const send = vi.fn();
  await expect(new FanvueConnector(auth, send).sendTextReply('../users', 'Hello', allowFixtureDispatch)).rejects.toThrow('inbox user');
  expect(send).not.toHaveBeenCalled();
});
it.each([400, 401, 403, 410, 429])('classifies documented HTTP %s as rejection without retry', async status => {
  const send = vi.fn(async () => new Response('private provider body', { status }));
  await expect(new FanvueConnector(auth, send).sendTextReply(user, 'Hello', allowFixtureDispatch)).rejects.toMatchObject({ outcome: 'rejected', status });
  expect(send).toHaveBeenCalledTimes(1);
});
it.each([200, 202, 404, 500, 502, 504])('keeps non-contract HTTP %s uncertain without retry', async status => {
  const send = vi.fn(async () => new Response('{}', { status }));
  await expect(new FanvueConnector(auth, send).sendTextReply(user, 'Hello', allowFixtureDispatch)).rejects.toMatchObject({ outcome: 'uncertain', status });
  expect(send).toHaveBeenCalledTimes(1);
});
it.each(['{}', '{bad', '{"messageUuid":"not-an-id"}'])('treats an invalid successful receipt as uncertain', async body => {
  const send = vi.fn(async () => new Response(body, { status: 201 }));
  await expect(new FanvueConnector(auth, send).sendTextReply(user, 'Hello', allowFixtureDispatch)).rejects.toMatchObject({ outcome: 'uncertain' });
  expect(send).toHaveBeenCalledTimes(1);
});
it('never retries a lost response or exposes the transport error text', async () => {
  const send = vi.fn(async () => { throw new Error('private message and credential'); });
  const error = await new FanvueConnector(auth, send).sendTextReply(user, 'Hello', allowFixtureDispatch).catch(e => e);
  expect(error.outcome).toBe('uncertain'); expect(error.message).not.toContain('credential');
  expect(send).toHaveBeenCalledTimes(1);
});
