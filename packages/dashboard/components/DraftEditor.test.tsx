import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, send: vi.fn(), refresh: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = hooks.index++; if (!(i in hooks.slots)) hooks.slots[i] = initial;
    return [hooks.slots[i], (value: unknown) => { hooks.slots[i] = value; }]; },
  useRef: (initial: unknown) => { const i = hooks.index++; return hooks.slots[i] ??= { current: initial }; },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
vi.mock('@/lib/mutation', () => ({ mutationFetch: hooks.send, createIdempotencyKey: () => 'stable-edit' }));
import DraftEditor from './DraftEditor';
const defaults = { bundleId: '11111111-1111-4111-8111-111111111111', revisionId: '22222222-2222-4222-8222-222222222222', captions: { instagram: 'Caption', x: 'Other caption' }, hashtags: ['one', 'two'] };
let props: Parameters<typeof DraftEditor>[0];
interface Node { type: unknown; props: { children?: unknown; disabled?: boolean; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void } }
function find(value: unknown, type: unknown, text?: string): Node | undefined {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) { const found = find(item, type, text); if (found) return found; } return; }
  const node = value as Node;
  if (node.type === type && (text === undefined || node.props.children === text)) return node;
  return find(node.props?.children, type, text);
}
function render() { hooks.index = 0; return DraftEditor(props); }
function click(text = 'Save draft and rescan') { const button = find(render(), 'button', text); expect(button).toBeDefined(); button!.props.onClick!(); }
function receipt(id = defaults.bundleId) { return Response.json({ data: { id, state: 'generated', tosReport: { verdict: 'pending', revisionId: '33333333-3333-4333-8333-333333333333' } } }); }
beforeEach(() => { hooks.slots = []; hooks.index = 0; hooks.send.mockReset(); hooks.refresh.mockReset(); props = { ...defaults }; });
it('saves all destinations with an expected revision and fences double clicks', async () => {
  let resolve!: (value: Response) => void;
  hooks.send.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const button = find(render(), 'button', 'Save draft and rescan')!;
  button.props.onClick!(); button.props.onClick!();
  expect(hooks.send).toHaveBeenCalledOnce();
  expect(hooks.send.mock.calls[0][0]).toBe(`/api/v1/bundles/${defaults.bundleId}/draft`);
  expect(hooks.send.mock.calls[0][1].method).toBe('PATCH');
  expect(JSON.parse(hooks.send.mock.calls[0][1].body)).toEqual({ expectedRevisionId: defaults.revisionId, captions: defaults.captions, hashtags: defaults.hashtags, scheduleRequest: null });
  resolve(receipt()); await vi.waitFor(() => expect(hooks.refresh).toHaveBeenCalledOnce());
  expect(find(render(), 'button', 'Save draft and rescan')).toBeUndefined();
});
it('preserves the exact existing requested instant instead of rounding it through local time', async () => {
  props.publishIntent = { action: 'schedule', platform: 'x', scheduledAt: '2099-01-01T12:00:45.123Z' };
  hooks.send.mockResolvedValueOnce(receipt()); click();
  await vi.waitFor(() => expect(hooks.refresh).toHaveBeenCalledOnce());
  expect(JSON.parse(hooks.send.mock.calls[0][1].body).scheduleRequest).toEqual({ platform: 'x', scheduledAt: props.publishIntent.scheduledAt });
});
it('allows removing an expired posting request without changing captions', async () => {
  props.publishIntent = { action: 'schedule', platform: 'x', scheduledAt: '2000-01-01T12:00:00Z' };
  click(); expect(hooks.send).not.toHaveBeenCalled();
  find(render(), 'select')!.props.onChange!({ target: { value: 'remove' } });
  hooks.send.mockResolvedValueOnce(receipt()); click();
  await vi.waitFor(() => expect(hooks.refresh).toHaveBeenCalledOnce());
  expect(JSON.parse(hooks.send.mock.calls[0][1].body).scheduleRequest).toBeNull();
});
it('validates and converts a requested local time', async () => {
  find(render(), 'select')!.props.onChange!({ target: { value: 'change' } });
  click(); expect(hooks.send).not.toHaveBeenCalled();
  find(render(), 'input')!.props.onChange!({ target: { value: '2099-01-01T12:00' } });
  hooks.send.mockResolvedValueOnce(receipt()); click();
  await vi.waitFor(() => expect(hooks.refresh).toHaveBeenCalledOnce());
  expect(JSON.parse(hooks.send.mock.calls[0][1].body).scheduleRequest).toEqual({ platform: 'instagram', scheduledAt: new Date('2099-01-01T12:00').toISOString() });
});
it('retains identical intent after lost response and mismatched receipt', async () => {
  hooks.send.mockRejectedValueOnce(new Error('lost')); click();
  await vi.waitFor(() => expect(find(render(), 'button', 'Retry same edit')?.props.disabled).toBe(false));
  expect(find(render(), 'fieldset')!.props.disabled).toBe(true);
  hooks.send.mockResolvedValueOnce(receipt('wrong')); click('Retry same edit');
  await vi.waitFor(() => expect(find(render(), 'button', 'Retry same edit')?.props.disabled).toBe(false));
  expect(hooks.send.mock.calls[0]).toEqual(hooks.send.mock.calls[1]);
  expect(hooks.refresh).not.toHaveBeenCalled();
});
it.each([400, 401, 403, 404, 409, 422])('requires reload after terminal %s', async status => {
  hooks.send.mockResolvedValueOnce(Response.json({ error: { message: 'Rejected' } }, { status })); click();
  await vi.waitFor(() => expect(find(render(), 'button', 'Reload draft')).toBeDefined());
  expect(find(render(), 'fieldset')!.props.disabled).toBe(true);
  expect(find(render(), 'button', 'Retry same edit')).toBeUndefined();
});
