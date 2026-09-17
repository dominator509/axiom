import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, refresh: vi.fn() }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useRef: (initial: unknown) => ({ current: initial }),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value;
    }];
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
import LinkbioPanel from './LinkbioPanel';

beforeEach(() => { hooks.values = []; hooks.index = 0; hooks.refresh.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

function panel(enabled: boolean, canEdit = true) {
  hooks.index = 0;
  return LinkbioPanel({ modelId: 'model', canEdit, providers: [{
    id: 'native', kind: 'native', enabled, isPrimary: false,
    config: { metadata: { source: 'saved-configuration' }, links: [{ label: 'Saved destination', url: 'https://example.com/saved' }] },
  }] });
}

function findButton(element: ReactElement, label: string): ReactElement<{ onClick: () => Promise<void> }> | undefined {
  const props = element.props as { children?: unknown };
  if (element.type === 'button' && props.children === label) return element as ReactElement<{ onClick: () => Promise<void> }>;
  for (const child of [props.children].flat(Infinity)) {
    if (child && typeof child === 'object' && 'props' in child) {
      const found = findButton(child as ReactElement, label);
      if (found) return found;
    }
  }
}

it('does not offer enable while the native page is already active', () => {
  expect(findButton(panel(true), 'Enable native page')).toBeUndefined();
});

it('does not expose provider mutations to read-only users', () => {
  const html = renderToStaticMarkup(panel(false, false));
  expect(html).not.toContain('Enable native page');
  expect(html).toContain('Link-in-bio changes require an owner, manager or operator role.');
});

it('preserves unrelated saved configuration when saving edited links', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { kind: 'native', enabled: true } }), { status: 201, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  panel(true);
  hooks.values[4] = [{ label: 'Updated', url: 'https://example.com/new' }];
  await findButton(panel(true), 'Save links')!.props.onClick();
  expect(JSON.parse(fetch.mock.calls[0][1].body).config).toEqual({
    metadata: { source: 'saved-configuration' },
    links: [{ label: 'Updated', url: 'https://example.com/new' }],
  });
});

it.each([
  ['x'.repeat(121), 'https://example.com', '120'],
  ['Label', `https://example.com/${'x'.repeat(2048)}`, '2048'],
])('rejects entries the public renderer would silently omit', async (label, url, limit) => {
  panel(true);
  const savedLinks = hooks.values[4];
  hooks.values[5] = label;
  hooks.values[6] = url;
  await findButton(panel(true), 'Add link')!.props.onClick();
  expect(hooks.values[3]).toEqual(expect.stringContaining(limit));
  expect(hooks.values[4]).toBe(savedLinks);
});

it('accepts labels and URLs at the renderer limits', async () => {
  panel(true);
  const label = 'x'.repeat(120);
  const url = 'https://example.com/'.padEnd(2048, 'x');
  hooks.values[5] = label;
  hooks.values[6] = url;
  await findButton(panel(true), 'Add link')!.props.onClick();
  expect(hooks.values[3]).toBeNull();
  expect(hooks.values[4]).toEqual(expect.arrayContaining([{ label, url }]));
});

it('re-enables without replacing configuration and retains saved links after refresh', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { kind: 'native', enabled: true } }), { status: 201, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  await findButton(panel(false), 'Enable native page')!.props.onClick();
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ kind: 'native' });
  expect(hooks.refresh).toHaveBeenCalledOnce();
  expect(renderToStaticMarkup(panel(true))).toContain('Saved destination');
});
