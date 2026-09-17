import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0, send: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = value; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.index++;
    return hooks.slots[index] ??= { current: initial };
  },
}));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: () => 'intent-key', mutationFetch: hooks.send }));
import MediaBundleCreate from './MediaBundleCreate';
function render() { hooks.index = 0; return MediaBundleCreate({ modelId: 'model', assetId: 'asset', mimeType: 'image/jpeg' }); }
function find(node: any, type: string): any {
  if (!node || typeof node !== 'object') return;
  if (node.type === type) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const result = find(child, type); if (result) return result; }
}
beforeEach(() => { hooks.index = 0; hooks.slots = []; hooks.send.mockReset(); });
it('keeps the exact user intent across an uncertain response and prevents concurrent dispatch', async () => {
  find(render(), 'textarea').props.onChange({ target: { value: 'A ceramic vase' } });
  let reject!: (error: Error) => void;
  hooks.send.mockReturnValueOnce(new Promise((_resolve, rejectCall) => { reject = rejectCall; }));
  const button = find(render(), 'button');
  button.props.onClick(); button.props.onClick();
  expect(hooks.send).toHaveBeenCalledTimes(1);
  reject(new Error('Lost response'));
  await vi.waitFor(() => expect(find(render(), 'button').props.children).toBe('Check same request'));
  expect(find(render(), 'fieldset').props.disabled).toBe(true);
  hooks.send.mockResolvedValueOnce(Response.json({ data: { id: '11111111-1111-4111-8111-111111111111' } }));
  find(render(), 'button').props.onClick();
  await vi.waitFor(() => expect(find(render(), 'button')).toBeUndefined());
  expect(hooks.send).toHaveBeenCalledTimes(2);
  expect(hooks.send.mock.calls[1]).toEqual(hooks.send.mock.calls[0]);
  expect(JSON.parse(hooks.send.mock.calls[0][1].body)).toEqual({ modelId: 'model', assetId: 'asset', captions: { instagram: 'A ceramic vase' }, hashtags: [] });
});
