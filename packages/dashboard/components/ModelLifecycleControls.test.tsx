import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      key === 'lifecycle.confirmDeactivate'
        ? `Deactivate ${String(values?.name ?? '')}? Existing media, approvals, and records will be retained.`
        : key,
  }),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (value: unknown) => [value, vi.fn()],
  useRef: (current: unknown) => ({ current }),
}));
vi.mock('@/lib/mutation', () => ({
  createIdempotencyKey: () => 'lifecycle-intent',
  mutationFetch: state.send,
}));
import ModelLifecycleControls from './ModelLifecycleControls';

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

type ButtonElement = { props: { onClick: () => Promise<void> } };
type LifecycleElement = {
  props: { children: [unknown, { props: { children: [unknown, ButtonElement] } }] };
};

it('requires confirmation before deactivation and preserves the same intent after uncertainty', async () => {
  const confirm = vi.fn(() => true);
  vi.stubGlobal('window', { confirm });
  state.send
    .mockResolvedValueOnce(new Response('{}'))
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'm1', isActive: false } })));
  const view = ModelLifecycleControls({
    model: { id: 'm1', displayName: 'Luna', isActive: true },
    canEdit: true,
  }) as unknown as LifecycleElement;
  const button = view.props.children[1].props.children[1];
  await button.props.onClick();
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Deactivate Luna'));
  expect(state.send).toHaveBeenCalledTimes(1);
  await button.props.onClick();
  expect(state.send).toHaveBeenCalledTimes(2);
  expect(state.send.mock.calls[0]).toEqual(state.send.mock.calls[1]);
  expect(state.refresh).toHaveBeenCalledOnce();
});

it('does not render lifecycle controls to read-only roles', () => {
  expect(
    ModelLifecycleControls({
      model: { id: 'm1', displayName: 'Luna', isActive: false },
      canEdit: false,
    }),
  ).toBeNull();
});
