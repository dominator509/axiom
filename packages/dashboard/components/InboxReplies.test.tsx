import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, send: vi.fn(), fetch: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = hooks.index++;
    if (!(i in hooks.slots)) hooks.slots[i] = initial;
    return [hooks.slots[i], (value: unknown) => { hooks.slots[i] = typeof value === 'function' ? value(hooks.slots[i]) : value; }];
  },
  useRef: (initial: unknown) => { const i = hooks.index++; return hooks.slots[i] ??= { current: initial }; },
}));
vi.mock('@/lib/mutation', () => ({ mutationFetch: hooks.send }));
import InboxReplies, { isInboxReply } from './InboxReplies';
const id = '11111111-1111-4111-8111-111111111111';
const key = '22222222-2222-4222-8222-222222222222';
const scope = { modelId: id, connectionId: id, counterpartUuid: id };
const reply = { ...scope, id, intentKey: key, actorUserId: 'actor', body: 'Exact reply', state: 'pending', createdAt: '2026-09-17T00:00:00Z', remoteMessageUuid: null };
interface Node { type: unknown; props: { children?: unknown; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void; disabled?: boolean } }
function find(value: unknown, type: string, text?: string): Node | undefined {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) { const found = find(item, type, text); if (found) return found; } return; }
  const node = value as Node;
  if (node.type === type && (text === undefined || node.props.children === text)) return node;
  return find(node.props?.children, type, text);
}
function render(canPrepare = true) { hooks.index = 0; return InboxReplies({ ...scope, canPrepare, actorUserId: 'actor' }); }
function click(text: string) { const button = find(render(), 'button', text); expect(button).toBeDefined(); button!.props.onClick!(); }
async function load(data: unknown[] = [], cursor: string | null = null) {
  hooks.fetch.mockResolvedValueOnce(Response.json({ data, meta: { next_cursor: cursor } }));
  click('Load reply history');
  await vi.waitFor(() => expect(find(render(), 'button', 'Load reply history')!.props.disabled).toBe(false));
}
beforeEach(() => {
  hooks.slots = []; hooks.index = 0; hooks.send.mockReset(); hooks.fetch.mockReset();
  vi.stubGlobal('fetch', hooks.fetch); vi.stubGlobal('crypto', { randomUUID: () => key });
});
afterEach(() => vi.unstubAllGlobals());

it('validates conversation identity, state and delivery receipt instead of trusting a success response', () => {
  expect(isInboxReply(reply, scope)).toBe(true);
  for (const patch of [{ modelId: key }, { connectionId: key }, { counterpartUuid: key }, { intentKey: 'bad' }, { body: '' }, { state: 'sent' }, { state: 'toString' }, { createdAt: 'bad' }, { remoteMessageUuid: id }])
    expect(isInboxReply({ ...reply, ...patch }, scope)).toBe(false);
  expect(isInboxReply({ ...reply, state: 'sent', remoteMessageUuid: id }, scope)).toBe(true);
});
it('requires verified history before preparation and gives read-only users no composer', async () => {
  expect(find(render(), 'textarea')!.props.disabled).toBe(true);
  expect(find(render(false), 'textarea')).toBeUndefined();
  await load([{ ...reply, counterpartUuid: key }]);
  expect(find(render(), 'textarea')!.props.disabled).toBe(true);
  expect(hooks.send).not.toHaveBeenCalled();
  await load();
  expect(find(render(), 'textarea')!.props.disabled).toBe(false);
});
it('fences double clicks and reuses exact text and key after a lost save response', async () => {
  await load();
  find(render(), 'textarea')!.props.onChange!({ target: { value: reply.body } });
  let reject!: (error: Error) => void;
  hooks.send.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  click('Save reply without sending'); click('Retry saving same reply');
  expect(hooks.send).toHaveBeenCalledTimes(1);
  reject(new Error('private network error'));
  await vi.waitFor(() => expect(find(render(), 'button', 'Retry saving same reply')!.props.disabled).toBe(false));
  expect(find(render(), 'textarea')!.props.disabled).toBe(true);
  hooks.send.mockResolvedValueOnce(Response.json({ data: reply }));
  click('Retry saving same reply');
  await vi.waitFor(() => expect(find(render(), 'h4', 'Prepared — not sent')).toBeDefined());
  expect(hooks.send.mock.calls[1]).toEqual(hooks.send.mock.calls[0]);
  expect(hooks.send.mock.calls[0][2]).toEqual({ idempotencyKey: key, retries: 0 });
  expect(JSON.parse(hooks.send.mock.calls[0][1].body)).toEqual({ connectionId: id, counterpartUuid: id, intentKey: key, body: reply.body });
});
it('recovers a lost save by reading the exact intent without sending another mutation', async () => {
  await load();
  find(render(), 'textarea')!.props.onChange!({ target: { value: reply.body } });
  hooks.send.mockRejectedValueOnce(new Error('lost'));
  click('Save reply without sending');
  await vi.waitFor(() => expect(find(render(), 'button', 'Retry saving same reply')!.props.disabled).toBe(false));
  await load([reply]);
  expect(find(render(), 'button', 'Retry saving same reply')).toBeUndefined();
  expect(find(render(), 'p', 'Saved reply found in history. Check its status below.')).toBeDefined();
  expect(hooks.send).toHaveBeenCalledTimes(1);
});
it('does not unlock or claim success for a different intent receipt', async () => {
  await load();
  find(render(), 'textarea')!.props.onChange!({ target: { value: reply.body } });
  hooks.send.mockResolvedValueOnce(Response.json({ data: { ...reply, intentKey: id } }));
  click('Save reply without sending');
  await vi.waitFor(() => expect(find(render(), 'button', 'Retry saving same reply')!.props.disabled).toBe(false));
  expect(find(render(), 'h4')).toBeUndefined();
  expect(find(render(), 'textarea')!.props.disabled).toBe(true);
});
it('retains conversation scope on older pages and distinguishes uncertain delivery', async () => {
  await load([{ ...reply, state: 'uncertain' }], id);
  hooks.fetch.mockResolvedValueOnce(Response.json({ data: [reply], meta: { next_cursor: null } }));
  click('Load older replies');
  await vi.waitFor(() => expect(find(render(), 'button', 'Load older replies')).toBeUndefined());
  expect(hooks.fetch.mock.calls[1][0]).toContain(`connectionId=${id}&counterpartUuid=${id}&cursor=${id}`);
  expect(find(render(), 'h4', 'Delivery uncertain — do not resend')).toBeDefined();
  expect(hooks.send).not.toHaveBeenCalled();
});
it('requires explicit confirmation, fences double clicks and sends only the immutable reply ID', async () => {
  await load([reply]);
  click('Send prepared reply');
  expect(hooks.send).not.toHaveBeenCalled();
  click('Keep prepared');
  expect(find(render(), 'button', 'Confirm send to Fanvue')).toBeUndefined();
  click('Send prepared reply');
  let complete!: (response: Response) => void;
  hooks.send.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
  const confirm = find(render(), 'button', 'Confirm send to Fanvue')!;
  confirm.props.onClick!(); confirm.props.onClick!();
  expect(hooks.send).toHaveBeenCalledOnce();
  expect(hooks.send.mock.calls[0]).toEqual([`/api/v1/models/${id}/inbox/replies/${id}/send`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"confirm":true}',
  }, { idempotencyKey: key, retries: 0 }]);
  complete(Response.json({ data: { replyId: id, state: 'sent' } }));
  await vi.waitFor(() => expect(find(render(), 'button', 'Load reply history')!.props.disabled).toBe(false));
  expect(find(render(), 'h4', 'Prepared — not sent')).toBeUndefined();
  expect(find(render(), 'h4', 'Action attempted — refresh status')).toBeDefined();
  expect(find(render(), 'button', 'Send prepared reply')).toBeUndefined();
  await load([{ ...reply, state: 'sent', remoteMessageUuid: key }]);
  expect(find(render(), 'h4', 'Accepted by Fanvue — not a read receipt')).toBeDefined();
  expect(find(render(), 'button', 'Send prepared reply')).toBeUndefined();
});
it('does not send someone else’s reply or a non-pending attempt', async () => {
  await load([{ ...reply, actorUserId: 'other' }]);
  expect(find(render(), 'button', 'Send prepared reply')).toBeUndefined();
  await load([{ ...reply, state: 'uncertain' }]);
  expect(find(render(), 'button', 'Send prepared reply')).toBeUndefined();
  expect(hooks.send).not.toHaveBeenCalled();
});
it('requires history after a lost send response instead of offering transport retry', async () => {
  await load([reply]);
  hooks.send.mockRejectedValueOnce(new Error('private-network-detail'));
  click('Send prepared reply'); click('Confirm send to Fanvue');
  await vi.waitFor(() => expect(find(render(), 'button', 'Load reply history')!.props.disabled).toBe(false));
  expect(find(render(), 'button', 'Send prepared reply')).toBeUndefined();
  expect(find(render(), 'p', 'Delivery not confirmed. Do not resend or create a duplicate. Load reply history to check status and access.')).toBeDefined();
  expect(hooks.send).toHaveBeenCalledOnce();
});
it('confirms cancellation separately and preserves the cancelled history', async () => {
  await load([reply]);
  click('Cancel prepared reply');
  expect(find(render(), 'button', 'Confirm send to Fanvue')).toBeUndefined();
  expect(hooks.send).not.toHaveBeenCalled();
  hooks.send.mockResolvedValueOnce(Response.json({ data: { replyId: id, state: 'cancelled' } }));
  click('Confirm cancellation');
  await vi.waitFor(() => expect(find(render(), 'h4', 'Cancelled — not sent')).toBeDefined());
  expect(hooks.send.mock.calls[0][0]).toBe(`/api/v1/models/${id}/inbox/replies/${id}/cancel`);
  expect(hooks.send.mock.calls[0][2]).toEqual({ idempotencyKey: key, retries: 0 });
  expect(find(render(), 'button', 'Send prepared reply')).toBeUndefined();
  expect(find(render(), 'p', reply.body)).toBeDefined();
});
it('does not claim cancellation after a lost or mismatched receipt', async () => {
  await load([reply]);
  hooks.send.mockResolvedValueOnce(Response.json({ data: { replyId: key, state: 'cancelled' } }));
  click('Cancel prepared reply'); click('Confirm cancellation');
  await vi.waitFor(() => expect(find(render(), 'button', 'Load reply history')!.props.disabled).toBe(false));
  expect(find(render(), 'h4', 'Cancelled — not sent')).toBeUndefined();
  expect(find(render(), 'button', 'Send prepared reply')).toBeUndefined();
  expect(find(render(), 'h4', 'Action attempted — refresh status')).toBeDefined();
});
