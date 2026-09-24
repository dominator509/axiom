import { afterEach, expect, it, vi } from 'vitest';
import { CATALOGS, LocaleCatalog, SUPPORTED_LOCALES, type SupportedLocale } from '@axiom/core';

const state = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn(), input: 'chat-123', intentRef: { current: null as unknown } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (value: unknown) => [value === '' ? state.input : value, vi.fn()],
  useRef: (current: unknown) => current === null ? state.intentRef : { current },
}));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: () => 'relay-intent', mutationFetch: state.send }));
vi.mock('@/lib/response', () => ({ readDashboardError: vi.fn(async () => ({})), readDashboardJson: vi.fn(async () => ({ data: { id: 'server-generated-id', modelId: 'm1', enabled: true } })) }));
import RelayBindingManager from './RelayBindingManager';

afterEach(() => { state.input = 'chat-123'; state.intentRef.current = null; vi.clearAllMocks(); vi.unstubAllGlobals(); });

type ButtonElement = { props: { onClick: () => Promise<void> | void } };
type ManagerElement = { props: { children: Array<unknown> } };

const catalog = new LocaleCatalog(CATALOGS);
const translate = (locale: SupportedLocale) => (key: string, values?: Record<string, string | number>) => catalog.t(locale, key, values);

function textOf(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (node && typeof node === 'object' && 'props' in node) return textOf((node as { props?: { children?: unknown } }).props?.children);
  return '';
}

it('accepts the server-generated id for a new relay binding', async () => {
  state.send.mockResolvedValue(new Response(JSON.stringify({ data: { id: 'server-generated-id', modelId: 'm1', enabled: true } }), { status: 201 }));
  const view = RelayBindingManager({ modelId: 'm1', bindings: [], canEdit: true, t: translate('en') }) as unknown as ManagerElement;
  const fieldset = view.props.children[2] as { props: { children: Array<unknown> } };
  const formRow = fieldset.props.children[1] as { props: { children: Array<unknown> } };
  const addButton = formRow.props.children[2] as ButtonElement;

  await addButton.props.onClick();
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(state.send).toHaveBeenCalledOnce();
  expect(state.send.mock.calls[0]?.[0]).toBe('/api/v1/models/m1/relay-bindings');
  expect(state.refresh).toHaveBeenCalledOnce();
});

it.each(SUPPORTED_LOCALES)('renders relay controls from the %s catalog', (locale) => {
  const view = RelayBindingManager({ modelId: 'm1', bindings: [], canEdit: true, t: translate(locale) }) as unknown as ManagerElement;
  const text = textOf(view);

  expect(text).toContain(catalog.t(locale, 'relay.binding.description'));
  expect(text).toContain(catalog.t(locale, 'relay.binding.empty'));
  expect(text).toContain(catalog.t(locale, 'relay.binding.formLegend'));
  expect(text).toContain(catalog.t(locale, 'relay.binding.add'));
});

it('keeps relay configuration guidance visible for read-only roles', () => {
  const view = RelayBindingManager({ modelId: 'm1', bindings: [], canEdit: false, t: translate('en') }) as unknown as ManagerElement;
  const text = textOf(view);

  expect(text).toContain(catalog.t('en', 'relay.binding.roleRequired'));
  expect(text).not.toContain(catalog.t('en', 'relay.binding.formLegend'));
});

it('renders populated enabled and disabled rows with localized actions and confirmation', async () => {
  const confirm = vi.fn(() => false);
  vi.stubGlobal('window', { confirm });
  const bindings = [
    { id: 'enabled-1', modelId: 'm1', channel: 'telegram', chatRef: 'chat-1', enabled: true, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'disabled-1', modelId: 'm1', channel: 'discord', chatRef: 'chat-2', enabled: false, createdAt: '2026-01-01T00:00:00Z' },
  ];
  const view = RelayBindingManager({ modelId: 'm1', bindings, canEdit: true, t: translate('de') }) as unknown as ManagerElement;
  const text = textOf(view);
  const table = view.props.children[1] as { props: { children: Array<unknown> } };
  const body = (table.props.children[1] as { props: { children: Array<unknown> } }).props.children;
  const firstRow = body[0] as { props: { children: Array<unknown> } };
  const firstRowAction = firstRow.props.children[3] as { props: { children: ButtonElement } };

  expect(text).toContain(catalog.t('de', 'relay.binding.enabled'));
  expect(text).toContain(catalog.t('de', 'relay.binding.disabled'));
  expect(text).toContain(catalog.t('de', 'relay.binding.disable'));
  expect(text).toContain(catalog.t('de', 'relay.binding.enable'));
  await firstRowAction.props.children.props.onClick();
  expect(confirm).toHaveBeenCalledWith(catalog.t('de', 'relay.binding.confirmDisable', { channel: 'telegram' }));
});

it('localizes validation, rejection, success, and retry-same-intent states', async () => {
  const seenKeys: string[] = [];
  const t = (key: string, values?: Record<string, string | number>) => {
    seenKeys.push(key);
    return catalog.t('en', key, values);
  };
  state.input = '';
  let view = RelayBindingManager({ modelId: 'm1', bindings: [], canEdit: true, t }) as unknown as ManagerElement;
  const firstFieldset = view.props.children[2] as { props: { children: Array<unknown> } };
  const firstFormRow = firstFieldset.props.children[1] as { props: { children: Array<unknown> } };
  await (firstFormRow.props.children[2] as ButtonElement).props.onClick();
  expect(seenKeys).toContain('relay.binding.validation');
  expect(state.send).not.toHaveBeenCalled();

  state.input = 'chat-123';
  state.send.mockResolvedValueOnce(new Response('rejected', { status: 500 }));
  view = RelayBindingManager({ modelId: 'm1', bindings: [], canEdit: true, t }) as unknown as ManagerElement;
  const rejectedFieldset = view.props.children[2] as { props: { children: Array<unknown> } };
  const rejectedFormRow = rejectedFieldset.props.children[1] as { props: { children: Array<unknown> } };
  await (rejectedFormRow.props.children[2] as ButtonElement).props.onClick();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(seenKeys).toContain('relay.binding.changeRejected');
  view = RelayBindingManager({ modelId: 'm1', bindings: [], canEdit: true, t }) as unknown as ManagerElement;
  expect(textOf(view)).toContain(catalog.t('en', 'relay.binding.retry'));

  state.send.mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'server-generated-id', modelId: 'm1', enabled: true } }), { status: 201 }));
  const retryButton = view.props.children[3] as ButtonElement;
  await retryButton.props.onClick();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(seenKeys).toContain('relay.binding.enabledSuccess');
  expect(state.send).toHaveBeenCalledTimes(2);
});
