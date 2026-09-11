import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], refs: [] as { current: unknown }[], i: 0, r: 0,
  connect: vi.fn(), status: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useEffect: vi.fn(),
  useState: (initial: unknown) => {
    const i = hooks.i++;
    if (!(i in hooks.values)) hooks.values[i] = initial;
    return [hooks.values[i], (value: unknown) => {
      hooks.values[i] = typeof value === 'function' ? value(hooks.values[i]) : value;
    }];
  },
  useRef: (initial: unknown) => hooks.refs[hooks.r++] ??= { current: initial },
}));
vi.mock('@/lib/grok-connection', () => ({ connectGrok: hooks.connect, grokConnectionStatus: hooks.status }));
import GrokConnection from './GrokConnection';
beforeEach(() => { hooks.values = []; hooks.refs = []; hooks.connect.mockReset(); hooks.status.mockReset(); });
afterEach(() => vi.useRealTimers());
function render() { hooks.i = 0; hooks.r = 0; return GrokConnection(); }
function buttons() { return render().props.children[2].props.children; }
it('performs no automatic login or status request on rendering', () => {
  render(); expect(hooks.connect).not.toHaveBeenCalled(); expect(hooks.status).not.toHaveBeenCalled();
});
it('shows connected only after login confirmation and clears login instructions', async () => {
  hooks.connect.mockImplementation(async (_signal, message) => { message('<script>not executable</script>'); });
  buttons()[1].props.onClick();
  await vi.waitFor(() => expect(hooks.values[0]).toBe('Grok login completed. Generation access has not yet been verified.'));
  expect(hooks.values[1]).toBe(''); expect(hooks.connect).toHaveBeenCalledOnce();
});
it('does not describe a local credential-file check as provider verification', async () => {
  hooks.status.mockResolvedValue(true);
  buttons()[0].props.onClick();
  await vi.waitFor(() => expect(hooks.values[0]).toBe('Grok credential file found. Provider access has not yet been verified.'));
  expect(hooks.connect).not.toHaveBeenCalled();
});
it('suppresses concurrent starts and aborts observation without claiming connection', async () => {
  let finish!: () => void;
  hooks.connect.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  buttons()[1].props.onClick(); buttons()[1].props.onClick();
  expect(hooks.connect).toHaveBeenCalledOnce();
  const signal = hooks.connect.mock.calls[0][0] as AbortSignal;
  buttons()[2].props.onClick();
  expect(signal.aborted).toBe(true);
  finish(); await Promise.resolve(); await Promise.resolve();
  expect(hooks.values[0]).toContain('cancelled');
});
