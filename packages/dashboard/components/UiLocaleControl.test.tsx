import { beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, send: vi.fn(), refresh: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: () => 'locale-intent', mutationFetch: hooks.send }));
vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      if (key === 'settings.savedAs') return `Language saved as ${values?.locale ?? ''}.`;
      if (key === 'settings.currentResolution') return `Current resolution: ${values?.locale ?? ''} (${values?.source ?? ''}).`;
      if (key === 'error.network') return 'Network problem. Please try again.';
      if (key === 'settings.retrySameLanguage') return 'Retry same language';
      if (key === 'settings.saving') return 'Saving…';
      if (key === 'settings.saveLanguage') return 'Save language';
      if (key === 'settings.language') return 'Language';
      if (key === 'settings.language.description') return 'Choose the interface language.';
      if (key === 'settings.appliesTo') return 'Applies to';
      if (key === 'settings.myAccount') return 'My account';
      if (key === 'settings.workspaceDefault') return 'Workspace default';
      if (key === 'settings.interfaceLanguage') return 'Interface language';
      return key;
    },
    setLocale: vi.fn(),
  }),
}));

import UiLocaleControl from './UiLocaleControl';
import type { UiLocaleSnapshot } from '@/lib/api';

vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => {
      hooks.slots[index] = typeof value === 'function' ? value(hooks.slots[index]) : value;
    }];
  },
  useRef: (initial: unknown) => ({ current: initial }),
}));

interface NodeProps {
  children?: unknown;
  onChange?: (event: { target: { value: string } }) => void;
  onSubmit?: (event: { preventDefault: () => void }) => void;
  [key: string]: unknown;
}

interface Node {
  type: unknown;
  props: NodeProps;
}

function findAll(value: unknown, predicate: (node: Node) => boolean, output: Node[] = []): Node[] {
  if (!value || typeof value !== 'object') return output;
  if (Array.isArray(value)) { for (const item of value) findAll(item, predicate, output); return output; }
  const node = value as Node;
  if (predicate(node)) output.push(node);
  findAll(node.props?.children, predicate, output);
  return output;
}

const initial: UiLocaleSnapshot = {
  locale: 'es',
  source: 'org',
  userLocale: null,
  orgLocale: 'es',
  supportedLocales: ['en', 'es', 'ja', 'it', 'pt-BR', 'de'],
  canSetOrg: true,
};

function render() {
  hooks.index = 0;
  return UiLocaleControl({ initial });
}

beforeEach(() => {
  hooks.slots = [];
  hooks.index = 0;
  hooks.send.mockReset();
  hooks.refresh.mockReset();
});

it('persists a user-selected locale with a stable intent key and refreshes the document', async () => {
  hooks.send.mockResolvedValue(Response.json({ data: { ...initial, locale: 'de', source: 'user', userLocale: 'de' } }));
  let tree = render();
  const selects = findAll(tree, node => node.type === 'select');
  expect(selects).toHaveLength(2);
  selects[1]!.props.onChange?.({ target: { value: 'de' } });
  tree = render();
  const form = findAll(tree, node => node.type === 'form')[0];
  expect(form).toBeDefined();
  form!.props.onSubmit?.({ preventDefault: vi.fn() });
  await vi.waitFor(() => expect(hooks.send).toHaveBeenCalledOnce());
  expect(hooks.send.mock.calls[0]?.[0]).toBe('/api/v1/ui-locale');
  expect(JSON.parse(hooks.send.mock.calls[0]?.[1].body)).toEqual({ scope: 'user', locale: 'de' });
  expect(hooks.send.mock.calls[0]?.[2]).toMatchObject({ idempotencyKey: 'locale-intent' });
});
