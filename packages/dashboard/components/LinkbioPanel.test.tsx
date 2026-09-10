import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, refresh: vi.fn() }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
import LinkbioPanel from './LinkbioPanel';

beforeEach(() => { hooks.values = []; hooks.index = 0; hooks.refresh.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

function panel(enabled: boolean) {
  hooks.index = 0;
  return LinkbioPanel({ modelId: 'model', providers: [{
    id: 'native', kind: 'native', enabled, isPrimary: false,
    config: { links: [{ label: 'Saved destination', url: 'https://example.com/saved' }] },
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

it('re-enables without replacing configuration and retains saved links after refresh', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  await findButton(panel(false), 'Enable native page')!.props.onClick();
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ kind: 'native' });
  expect(hooks.refresh).toHaveBeenCalledOnce();
  expect(renderToStaticMarkup(panel(true))).toContain('Saved destination');
});
