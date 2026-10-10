import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  index: 0,
  refIndex: 0,
  refresh: vi.fn(),
}));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
  useRef: (initial: unknown) => hooks.refs[hooks.refIndex++] ??= { current: initial },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
vi.mock('./LocaleProvider', () => ({ useLocale: () => ({ t: (key: string) => key }) }));

import PublishOutcomeReconciliation from './PublishOutcomeReconciliation';

beforeEach(() => { hooks.values = []; hooks.refs = []; hooks.refresh.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

function findButton(node: any, label: string): any {
  if (Array.isArray(node)) {
    for (const child of node) { const match = findButton(child, label); if (match) return match; }
  } else if (node && typeof node === 'object') {
    if (node.type === 'button' && node.props.children === label) return node;
    return findButton(node.props?.children, label);
  }
  return undefined;
}

function button(label: string) {
  hooks.index = 0; hooks.refIndex = 0;
  const tree = PublishOutcomeReconciliation({ jobId: 'job-a' });
  const result = findButton(tree, label);
  if (!result) throw new Error(`button not found: ${label}`);
  return result.props.onClick as () => Promise<void>;
}

it('requires provider readback confirmation and records the outcome without dispatch data', async () => {
  const confirm = vi.fn(() => false);
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}'));
  vi.stubGlobal('confirm', confirm);
  vi.stubGlobal('fetch', fetch);

  await button('incidents.reconcilePublished')();
  expect(confirm).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();

  confirm.mockReturnValue(true);
  await button('incidents.reconcilePublished')();
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][0]).toContain('/api/v1/incidents/job-a/reconcile');
  expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toEqual({ outcome: 'published', confirmed: true });

  await button('incidents.reconcileNotPublished')();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toEqual({ outcome: 'not_published', confirmed: true });
  expect(hooks.refresh).toHaveBeenCalledTimes(2);
});
