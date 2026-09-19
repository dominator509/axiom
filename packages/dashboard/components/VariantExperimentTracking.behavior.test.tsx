import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, send: vi.fn(), refresh: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = typeof value === 'function' ? value(hooks.slots[index]) : value; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.index++;
    return hooks.slots[index] ??= { current: initial };
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: () => 'tracking-key', mutationFetch: hooks.send }));
import VariantExperimentTracking from './VariantExperimentTracking';
type Element = { type: unknown; props: { children?: unknown; disabled?: boolean; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void } };
function find(node: unknown, predicate: (node: Element) => boolean): Element | undefined {
  if (!node || typeof node !== 'object' || !('props' in node)) return;
  const element = node as Element;
  if (predicate(element)) return element;
  for (const child of [element.props.children].flat(Infinity)) { const found = find(child, predicate); if (found) return found; }
}
function render() { hooks.index = 0; return VariantExperimentTracking({ modelId: 'model', experimentId: 'experiment', status: 'running', canEdit: true }); }
function button(label: string) { return find(render(), node => node.type === 'button' && node.props.children === label); }
beforeEach(() => { hooks.index = 0; hooks.slots = []; hooks.send.mockReset(); hooks.refresh.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
it('reuses exact allocation intent after a lost response and prevents concurrent submissions', async () => {
  find(render(), node => node.type === 'input')?.props.onChange?.({ target: { value: 'placement-42' } });
  let reject!: (error: Error) => void;
  hooks.send.mockReturnValueOnce(new Promise((_resolve, rejectCall) => { reject = rejectCall; }));
  button('Allocate variant')?.props.onClick?.(); button('Allocate variant')?.props.onClick?.();
  expect(hooks.send).toHaveBeenCalledTimes(1);
  reject(new Error('response lost'));
  await vi.waitFor(() => expect(button('Retry same tracking request')?.props.disabled).toBe(false));
  expect(find(render(), node => node.type === 'fieldset')?.props.disabled).toBe(true);
  const id = '11111111-1111-4111-8111-111111111111';
  hooks.send.mockResolvedValueOnce(Response.json({ data: { id, variantId: id } }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [], meta: { next_cursor: null } })));
  button('Retry same tracking request')?.props.onClick?.();
  await vi.waitFor(() => expect(hooks.refresh).toHaveBeenCalledTimes(1));
  expect(hooks.send.mock.calls[1]).toEqual(hooks.send.mock.calls[0]);
  expect(JSON.parse(hooks.send.mock.calls[0][1].body)).toEqual({ assignmentKey: 'placement-42' });
});
it('retains the request when the server returns a malformed success receipt', async () => {
  find(render(), node => node.type === 'input')?.props.onChange?.({ target: { value: 'placement-42' } });
  hooks.send.mockResolvedValueOnce(Response.json({ data: {} }));
  button('Allocate variant')?.props.onClick?.();
  await vi.waitFor(() => expect(button('Retry same tracking request')?.props.disabled).toBe(false));
  expect(hooks.refresh).not.toHaveBeenCalled();
});
