import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], refs: [] as { current: unknown }[], i: 0, r: 0 }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = hooks.i++;
    if (!(i in hooks.values)) hooks.values[i] = initial;
    return [hooks.values[i], (value: unknown) => { hooks.values[i] = value; }];
  },
  useRef: (initial: unknown) => hooks.refs[hooks.r++] ??= { current: initial },
}));
import GrokR2Storage from './GrokR2Storage';
const fetchMock = vi.fn();
beforeEach(() => { hooks.values = []; hooks.refs = []; fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function render() { hooks.i = 0; hooks.r = 0; return GrokR2Storage(); }
it('does not automatically request, exposes password fields and warns that saving is not verification', async () => {
  const tree = render();
  expect(fetchMock).not.toHaveBeenCalled();
  const form = tree.props.children[2];
  expect(form.props.autoComplete).toBe('off');
  for (const i of [2, 3]) expect(form.props.children[i].props.children[1].props.type).toBe('password');
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ configured: true, verified: false })));
  tree.props.children[3].props.children[0].props.onClick();
  await vi.waitFor(() => expect(hooks.values[0]).toContain('have not been verified'));
  expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' }));
});
it('offers an explicit bucket verification action and reports a verified result', async () => {
  const tree = render();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ configured: true, verified: true })));
  const buttons = tree.props.children[3].props.children.filter((child: unknown) =>
    typeof child === 'object' && child !== null && 'props' in child &&
    typeof (child as { props?: { onClick?: unknown } }).props?.onClick === 'function') as Array<{ props: { onClick: () => void } }>;
  buttons[1].props.onClick();
  await vi.waitFor(() => expect(hooks.values[0]).toContain('read/write verified'));
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/llm/subscriptions/grok/r2-storage/verify', expect.objectContaining({ method: 'POST' }));
});
it('clears entered values before sending, suppresses duplicate submission and never retries failures', async () => {
  const reset = vi.fn();
  vi.stubGlobal('FormData', class { get(key: string) { return key === 'secretAccessKey' ? 'test-secret' : 'test-field'; } });
  let reject!: (error: Error) => void;
  fetchMock.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  const submit = render().props.children[2].props.onSubmit;
  const event = { preventDefault: vi.fn(), currentTarget: { reset } };
  submit(event); submit(event);
  expect(reset).toHaveBeenCalledOnce(); expect(fetchMock).toHaveBeenCalledOnce();
  expect(reset.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]!);
  reject(new Error('test-secret'));
  await vi.waitFor(() => expect(hooks.values[0]).toContain('not confirmed'));
  expect(JSON.stringify(hooks.values)).not.toContain('test-secret');
  expect(fetchMock).toHaveBeenCalledOnce();
});
