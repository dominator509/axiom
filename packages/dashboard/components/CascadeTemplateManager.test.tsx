import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { formatNumber } from '@axiom/core';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, refs: [] as { current: unknown }[], r: 0,
  refresh: vi.fn(), confirm: vi.fn() }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useRef: (initial: unknown) => hooks.refs[hooks.r++] ??= { current: initial },
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value;
    }];
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
vi.mock('@/lib/mutation', () => ({
  createIdempotencyKey: () => 'cascade-intent',
  mutationFetch: (...args: unknown[]) => (globalThis as { __cascadeFetch?: (a: unknown, b: unknown) => Promise<Response> }).__cascadeFetch?.(args[0], args[1]) ?? Promise.reject(new Error('no fetch stub')),
}));
vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    locale: 'en',
    setLocale: () => undefined,
    t: (key: string, values?: Record<string, string | number>) => {
      const text = ({
        'cascade.intro': 'A cascade expands one approved bundle into normal scheduled targets such as X now, Instagram +2 hours, and Threads +3 hours. Each target still uses consent, account, ToS, kill-switch, and worker gates.',
        'cascade.empty': 'No cascade templates saved for this talent.',
        'cascade.disable': 'Disable',
        'cascade.enable': 'Enable',
        'cascade.delete': 'Delete',
        'cascade.expandSchedule': 'Expand schedule',
        'cascade.createLegend': 'Create cascade template',
        'cascade.templateName': 'Template name',
        'cascade.stepLabel': 'Step {index}',
        'cascade.minutesAfterBase': 'Minutes after base',
        'cascade.removeStep': 'Remove step',
        'cascade.addStep': 'Add step',
        'cascade.save': 'Save cascade template',
        'cascade.roleRequired': 'Cascade changes require an owner, manager, or operator role.',
        'cascade.expandLegend': 'Expand a saved template',
        'cascade.bundleId': 'Approved bundle ID',
        'cascade.bundleIdPlaceholder': 'UUID from Review & approve',
        'cascade.baseTime': 'Base schedule time',
        'cascade.expandNote': 'Expansion is a scheduling action. It will not bypass approval or create a provider connection.',
        'cascade.retry': 'Retry same cascade change',
        'cascade.error.validation': 'Enter a name and keep the first step at 0 minutes with ascending offsets.',
        'cascade.error.notAccepted': 'Cascade change was not accepted.',
        'cascade.error.notConfirmed': 'Cascade change was not confirmed. Retry the same intent.',
        'cascade.error.unconfirmedResponse': 'Unconfirmed cascade response',
        'cascade.error.expandInputs': 'Enter an approved bundle ID and a future base time before expanding.',
        'cascade.error.expandTargets': 'Cascade expansion did not return targets',
        'cascade.saved': 'Cascade template saved. Expansion still requires an approved bundle and connected destination accounts.',
        'cascade.expandedOne': 'Cascade expanded into 1 scheduled target.',
        'cascade.expandedMany': 'Cascade expanded into {count} scheduled targets.',
        'cascade.disabledMessage': '{name} disabled.',
        'cascade.enabledMessage': '{name} enabled.',
        'cascade.deleted': 'Cascade template deleted. Existing scheduled posts were retained.',
        'cascade.confirmExpand': 'Expand {name} into scheduled targets? This queues work but does not publish immediately.',
        'cascade.confirmDelete': 'Delete the {name} template? Existing scheduled posts are not removed.',
      } as Record<string, string>)[key] ?? key;
      return text.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_m, name: string) => String(values?.[name] ?? `{${name}}`));
    },
  }),
}));
import CascadeTemplateManager, { formatCascadeStepNumber } from './CascadeTemplateManager';

const template = { id: 'tmpl-1', modelId: 'model', name: 'Launch', enabled: true, steps: [{ platform: 'x', offsetMinutes: 0 }, { platform: 'instagram', offsetMinutes: 120 }], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };

beforeEach(() => {
  hooks.values = []; hooks.index = 0; hooks.refs = []; hooks.r = 0;
  hooks.refresh.mockReset(); hooks.confirm.mockReset();
  vi.stubGlobal('window', { confirm: hooks.confirm });
});
afterEach(() => vi.unstubAllGlobals());

/** Seed the bundle-id (index 2) and base-time (index 3) fields, then re-render. */
function managerWithInputs(templates: typeof template[], bundleId: string, baseTime: string) {
  manager(templates);
  hooks.values[2] = bundleId;
  hooks.values[3] = baseTime;
  return manager(templates);
}

function manager(templates: typeof template[], canEdit = true) {
  hooks.index = 0; hooks.r = 0;
  return CascadeTemplateManager({ modelId: 'model', templates, canEdit });
}

function findButton(element: ReactElement, label: string): ReactElement<{ onClick: () => unknown }> | undefined {
  const props = element.props as { children?: unknown };
  if (element.type === 'button' && props.children === label) return element as ReactElement<{ onClick: () => unknown }>;
  for (const child of [props.children].flat(Infinity)) {
    if (child && typeof child === 'object' && 'props' in child) {
      const found = findButton(child as ReactElement, label);
      if (found) return found;
    }
  }
}

it('renders the localized intro and empty state when no templates exist', () => {
  const html = renderToStaticMarkup(manager([]));
  expect(html).toContain('A cascade expands one approved bundle');
  expect(html).toContain('No cascade templates saved for this talent.');
  expect(html).toContain('Create cascade template');
});

it('renders localized per-template controls and keeps the authored name as data', () => {
  const html = renderToStaticMarkup(manager([template], true));
  expect(html).toContain('Launch');
  expect(html).toContain('Disable');
  expect(html).toContain('Delete');
  expect(html).toContain('Expand schedule');
});

it('hides the mutation controls from read-only users and shows the localized role copy', () => {
  const html = renderToStaticMarkup(manager([template], false));
  expect(html).not.toContain('Disable');
  expect(html).not.toContain('Delete');
  expect(html).toContain('Cascade changes require an owner, manager, or operator role.');
});

it('shows the localized validation error when the first step is not at zero minutes', async () => {
  manager([]);
  hooks.values[1] = [{ platform: 'x', offsetMinutes: 60 }];
  await findButton(manager([]), 'Save cascade template')!.props.onClick();
  expect(hooks.values[5]).toBe('Enter a name and keep the first step at 0 minutes with ascending offsets.');
});

it('confirms expansion with the interpolated template name and reports the localized count', async () => {
  hooks.confirm.mockReturnValue(true);
  (globalThis as Record<string, unknown>).__cascadeFetch = vi.fn()
    .mockResolvedValue(new Response(JSON.stringify({ data: [{ platform: 'x' }, { platform: 'instagram' }] }), { status: 201, headers: { 'content-type': 'application/json' } }));
  await findButton(managerWithInputs([template], 'bundle-uuid', '2030-01-01T10:00'), 'Expand schedule')!.props.onClick();
  expect(hooks.confirm).toHaveBeenCalledWith('Expand Launch into scheduled targets? This queues work but does not publish immediately.');
  await vi.waitFor(() => expect([...hooks.values].includes('Cascade expanded into 2 scheduled targets.')).toBe(true));
});

it('reports the localized singular count for a single expanded target', async () => {
  hooks.confirm.mockReturnValue(true);
  (globalThis as Record<string, unknown>).__cascadeFetch = vi.fn()
    .mockResolvedValue(new Response(JSON.stringify({ data: [{ platform: 'x' }] }), { status: 201, headers: { 'content-type': 'application/json' } }));
  await findButton(managerWithInputs([template], 'bundle-uuid', '2030-01-01T10:00'), 'Expand schedule')!.props.onClick();
  await vi.waitFor(() => expect([...hooks.values].includes('Cascade expanded into 1 scheduled target.')).toBe(true));
});

it('formats a large expansion count through the selected locale', async () => {
  hooks.confirm.mockReturnValue(true);
  (globalThis as Record<string, unknown>).__cascadeFetch = vi.fn()
    .mockResolvedValue(new Response(JSON.stringify({ data: Array.from({ length: 1234 }, () => ({ platform: 'x' })) }), { status: 201, headers: { 'content-type': 'application/json' } }));
  await findButton(managerWithInputs([template], 'bundle-uuid', '2030-01-01T10:00'), 'Expand schedule')!.props.onClick();
  await vi.waitFor(() => expect([...hooks.values].includes('Cascade expanded into 1,234 scheduled targets.')).toBe(true));
});

it('shows the localized expand-input error when the bundle ID or base time is blank', async () => {
  manager([template]);
  await findButton(manager([template]), 'Expand schedule')!.props.onClick();
  expect(hooks.values[5]).toBe('Enter an approved bundle ID and a future base time before expanding.');
});

it('confirms deletion with the interpolated template name and reports the localized result', async () => {
  hooks.confirm.mockReturnValue(true);
  (globalThis as Record<string, unknown>).__cascadeFetch = vi.fn()
    .mockResolvedValue(new Response(JSON.stringify({ data: { id: 'tmpl-1' } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  manager([template]);
  await findButton(manager([template]), 'Delete')!.props.onClick();
  expect(hooks.confirm).toHaveBeenCalledWith('Delete the Launch template? Existing scheduled posts are not removed.');
  await vi.waitFor(() => expect([...hooks.values].includes('Cascade template deleted. Existing scheduled posts were retained.')).toBe(true));
});

it('does not delete when the operator cancels the localized confirmation', async () => {
  hooks.confirm.mockReturnValue(false);
  const fetch = vi.fn();
  (globalThis as Record<string, unknown>).__cascadeFetch = fetch;
  manager([template]);
  await findButton(manager([template]), 'Delete')!.props.onClick();
  expect(fetch).not.toHaveBeenCalled();
});

it('formats cascade step numbers through the selected locale', () => {
  expect(formatCascadeStepNumber(1234, 'de')).toBe(formatNumber(1234, 'de'));
  expect(formatCascadeStepNumber(1234, 'ja')).toBe(formatNumber(1234, 'ja'));
});
