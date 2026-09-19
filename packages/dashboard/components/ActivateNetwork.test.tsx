import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// Stateful hook harness: rerenders preserve state/refs, without a browser or network mutation.
const harness = vi.hoisted(() => ({ values: [] as unknown[], index: 0, send: vi.fn(), key: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = harness.index++;
    if (!(index in harness.values)) harness.values[index] = initial;
    return [harness.values[index], (value: unknown) => { harness.values[index] = value; }];
  },
  useRef: (current: unknown) => {
    const index = harness.index++;
    if (!(index in harness.values)) harness.values[index] = { current };
    return harness.values[index];
  },
}));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: harness.key, mutationFetch: harness.send }));
import ActivateNetwork from './ActivateNetwork';

type Node = ReactElement<{ children?: Node[] | Node; type?: string; checked?: boolean; disabled?: boolean; onChange?: (event: { target: { checked: boolean } }) => void; onClick?: () => void }>;
function render() {
  harness.index = 0;
  const root = ActivateNetwork({ modelId: 'selected-model' }) as Node;
  const children = root.props.children as Node[];
  const input = (children[2].props.children as Node[])[0];
  return { input, button: children[3], message: children[4].props.children };
}
function approve() { render().input.props.onChange!({ target: { checked: true } }); }
function synced(bound = 1, skipped = 0) {
  return new Response(JSON.stringify({ data: { status: 'synced', bound, skipped } }));
}
beforeEach(() => {
  harness.values = []; harness.index = 0;
  harness.send.mockReset(); harness.key.mockReset().mockReturnValue('intent-1');
});

it('requires explicit approval and blocks repeated clicks while in flight', async () => {
  expect(render().button.props.disabled).toBe(true);
  render().button.props.onClick!();
  expect(harness.send).not.toHaveBeenCalled();
  let resolve!: (response: Response) => void;
  harness.send.mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
  approve();
  const approved = render();
  approved.button.props.onClick!(); approved.button.props.onClick!();
  expect(harness.send).toHaveBeenCalledOnce();
  expect(render().input.props.disabled).toBe(true);
  expect(render().button.props.disabled).toBe(true);
  resolve(synced());
  await vi.waitFor(() => expect(render().input.props.checked).toBe(false));
});

it('retries an uncertain request with the same model and key, never changing the safety switch', async () => {
  harness.send.mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce(synced());
  approve(); render().button.props.onClick!();
  await vi.waitFor(() => expect(render().message).toContain('not confirmed'));
  render().button.props.onClick!();
  await vi.waitFor(() => expect(render().message).toContain('reconciliation completed'));
  expect(harness.send.mock.calls[0]).toEqual(harness.send.mock.calls[1]);
  expect(harness.send).toHaveBeenCalledWith('/api/v1/egress/plane/sync', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"model_id":"selected-model"}',
  }, { idempotencyKey: 'intent-1', timeoutMs: 40000, retries: 0 });
  expect(harness.key).toHaveBeenCalledOnce();
  expect(render().message).toContain('does not mean the tunnel is healthy');
});

it.each([400, 401, 403, 404, 422])('requires new approval and a new intent after HTTP %i', async status => {
  harness.send.mockResolvedValueOnce(new Response('{}', { status })).mockResolvedValueOnce(synced());
  approve(); render().button.props.onClick!();
  await vi.waitFor(() => expect(render().message).toContain(`HTTP ${status}`));
  expect(render().button.props.disabled).toBe(true);
  harness.key.mockReturnValue('intent-2'); approve(); render().button.props.onClick!();
  await vi.waitFor(() => expect(render().message).toContain('reconciliation completed'));
  expect(harness.send.mock.calls[1][2].idempotencyKey).toBe('intent-2');
});

it.each([{}, { data: { status: 'synced', bound: -1, skipped: 0 } }, { data: { status: 'synced', bound: 1 } }])('does not report completion for an invalid successful response %j', async body => {
  harness.send.mockResolvedValueOnce(new Response(JSON.stringify(body))).mockResolvedValueOnce(synced(0, 1));
  approve(); render().button.props.onClick!();
  await vi.waitFor(() => expect(render().message).toContain('not confirmed'));
  render().button.props.onClick!();
  await vi.waitFor(() => expect(render().message).toContain('0 bound, 1 skipped'));
  expect(harness.key).toHaveBeenCalledOnce();
  expect(render().message).toContain('does not mean the tunnel is healthy');
});
