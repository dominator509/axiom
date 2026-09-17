import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (value: unknown) => [value === '' ? 'chat-123' : value, vi.fn()],
  useRef: (current: unknown) => ({ current }),
}));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: () => 'relay-intent', mutationFetch: state.send }));
vi.mock('@/lib/response', () => ({ readDashboardError: vi.fn(async () => ({})), readDashboardJson: vi.fn(async () => ({ data: { id: 'server-generated-id', modelId: 'm1', enabled: true } })) }));
import RelayBindingManager from './RelayBindingManager';

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

type ButtonElement = { props: { onClick: () => Promise<void> | void } };
type ManagerElement = { props: { children: Array<unknown> } };

it('accepts the server-generated id for a new relay binding', async () => {
  state.send.mockResolvedValue(new Response(JSON.stringify({ data: { id: 'server-generated-id', modelId: 'm1', enabled: true } }), { status: 201 }));
  const view = RelayBindingManager({ modelId: 'm1', bindings: [], canEdit: true }) as unknown as ManagerElement;
  const fieldset = view.props.children[2] as { props: { children: Array<unknown> } };
  const formRow = fieldset.props.children[1] as { props: { children: Array<unknown> } };
  const addButton = formRow.props.children[2] as ButtonElement;

  await addButton.props.onClick();
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(state.send).toHaveBeenCalledOnce();
  expect(state.send.mock.calls[0]?.[0]).toBe('/api/v1/models/m1/relay-bindings');
  expect(state.refresh).toHaveBeenCalledOnce();
});
