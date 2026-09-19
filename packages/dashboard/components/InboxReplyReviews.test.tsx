import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, send: vi.fn(), fetch: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = hooks.index++; if (!(i in hooks.slots)) hooks.slots[i] = initial;
    return [hooks.slots[i], (value: unknown) => { hooks.slots[i] = typeof value === 'function' ? value(hooks.slots[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = hooks.index++; return hooks.slots[i] ??= { current: initial }; },
}));
vi.mock('@/lib/mutation', () => ({ mutationFetch: hooks.send }));
import InboxReplyReviews, { isReplyReview } from './InboxReplyReviews';
const id = '11111111-1111-4111-8111-111111111111', key = '22222222-2222-4222-8222-222222222222';
const review = { id, modelId: id, replyId: id, actorUserId: 'operator', intentKey: key, conclusion: 'unresolved', observedMessageUuid: null, note: 'Reviewed exact conversation.', evidenceSource: 'operator_review', createdAt: '2026-09-17T00:00:00Z' };
interface Node { type: unknown; props: { children?: unknown; disabled?: boolean; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void } }
function find(value: unknown, type: string, text?: string): Node | undefined {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) { const found = find(item, type, text); if (found) return found; } return; }
  const node = value as Node;
  if (node.type === type && (text === undefined || node.props.children === text)) return node;
  return find(node.props?.children, type, text);
}
function render(canReview = true) { hooks.index = 0; return InboxReplyReviews({ modelId: id, replyId: id, canReview }); }
function click(text: string) { const node = find(render(), 'button', text); expect(node).toBeDefined(); node!.props.onClick!(); }
async function load(data: unknown[] = [], cursor: string | null = null) {
  hooks.fetch.mockResolvedValueOnce(Response.json({ data, meta: { next_cursor: cursor } })); click('Load delivery reviews');
  await vi.waitFor(() => expect(find(render(), 'button', 'Load delivery reviews')!.props.disabled).toBe(false));
}
beforeEach(() => { hooks.slots = []; hooks.index = 0; hooks.send.mockReset(); hooks.fetch.mockReset(); vi.stubGlobal('fetch', hooks.fetch); vi.stubGlobal('crypto', { randomUUID: () => key }); });
afterEach(() => vi.unstubAllGlobals());
it('rejects mismatched identity, fake automated evidence and inconsistent conclusions', () => {
  expect(isReplyReview(review, id, id)).toBe(true);
  for (const patch of [{ replyId: key }, { modelId: key }, { evidenceSource: 'provider_verified' }, { conclusion: 'observed_sent' }, { observedMessageUuid: id }, { note: '' }, { createdAt: 'bad' }])
    expect(isReplyReview({ ...review, ...patch }, id, id)).toBe(false);
});
it('requires valid history and keeps viewers read-only', async () => {
  expect(find(render(), 'fieldset')!.props.disabled).toBe(true);
  expect(find(render(false), 'textarea')).toBeUndefined();
  await load([{ ...review, replyId: key }]);
  expect(find(render(), 'fieldset')!.props.disabled).toBe(true);
  expect(find(render(), 'p', 'No recorded delivery reviews.')).toBeUndefined();
  await load(); expect(find(render(), 'fieldset')!.props.disabled).toBe(false);
});
it('retains the exact intent across lost responses and recovers it from history', async () => {
  await load(); find(render(), 'textarea')!.props.onChange!({ target: { value: review.note } });
  hooks.send.mockRejectedValueOnce(new Error('lost'));
  click('Record operator review');
  await vi.waitFor(() => expect(find(render(), 'button', 'Retry saving same review')!.props.disabled).toBe(false));
  expect(find(render(), 'fieldset')!.props.disabled).toBe(true);
  hooks.send.mockRejectedValueOnce(new Error('lost again')); click('Retry saving same review');
  await vi.waitFor(() => expect(find(render(), 'button', 'Retry saving same review')!.props.disabled).toBe(false));
  expect(hooks.send.mock.calls[0]).toEqual(hooks.send.mock.calls[1]);
  await load([review]);
  expect(find(render(), 'button', 'Retry saving same review')).toBeUndefined();
  expect(find(render(), 'h4', 'Operator could not resolve delivery')).toBeDefined();
});
it('requires a message UUID for an observed-send report, labels it as human evidence and fences double clicks', async () => {
  await load(); find(render(), 'textarea')!.props.onChange!({ target: { value: review.note } });
  find(render(), 'select')!.props.onChange!({ target: { value: 'observed_sent' } });
  expect(find(render(), 'button', 'Record operator review')!.props.disabled).toBe(true);
  find(render(), 'input')!.props.onChange!({ target: { value: id } });
  let resolve!: (response: Response) => void;
  hooks.send.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const save = find(render(), 'button', 'Record operator review')!; save.props.onClick!(); save.props.onClick!();
  expect(hooks.send).toHaveBeenCalledOnce();
  resolve(Response.json({ data: { ...review, conclusion: 'observed_sent', observedMessageUuid: id } }));
  await vi.waitFor(() => expect(find(render(), 'h4', 'Operator reports a sent message')).toBeDefined());
  expect(hooks.send.mock.calls[0][0]).toBe(`/api/v1/models/${id}/inbox/replies/${id}/reviews`);
  expect(hooks.send.mock.calls[0][2]).toEqual({ idempotencyKey: key, retries: 0 });
});
it('uses reply-scoped cursors and preserves history when loading older reviews', async () => {
  await load([review], id);
  hooks.fetch.mockResolvedValueOnce(Response.json({ data: [{ ...review, id: key }], meta: { next_cursor: null } }));
  click('Load older reviews');
  await vi.waitFor(() => expect(find(render(), 'button', 'Load older reviews')).toBeUndefined());
  expect(hooks.fetch.mock.calls[1][0]).toBe(`/api/v1/models/${id}/inbox/replies/${id}/reviews?cursor=${id}`);
  expect(hooks.send).not.toHaveBeenCalled();
});
