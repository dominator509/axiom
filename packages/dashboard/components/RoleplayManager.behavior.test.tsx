import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const harness = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as Array<() => unknown> }));

vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = harness.index++;
    if (!(index in harness.values)) harness.values[index] = initial;
    return [harness.values[index], (value: unknown) => { harness.values[index] = value; }];
  },
  useEffect: (effect: () => unknown) => { harness.effects.push(effect); },
  useMemo: (factory: () => unknown) => factory(),
}));

vi.mock('@/lib/mutation', () => ({
  createIdempotencyKey: () => 'persona-save-test-key',
  mutationFetch: (path: string, init: RequestInit) => globalThis.fetch(path, init),
}));

vi.mock('@/lib/response', () => ({
  readDashboardJson: async (response: Response) => response.json(),
}));

vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    locale: 'en',
    setLocale: vi.fn(),
    t: (key: string) => ({
      'roleplay.useSuggested': 'Use suggested personality',
      'roleplay.writeManually': 'Write manually',
      'roleplay.personaPlaceholder': 'Write bounded character guidance…',
      'roleplay.savePersona': 'Save new persona revision',
      'roleplay.personaSaved': 'Persona revision saved',
      'roleplay.contextUnavailable': 'Roleplay context unavailable',
      'roleplay.changeUnconfirmed': 'Change unconfirmed',
      'roleplay.reloadContext': 'Reload bounded context',
      'roleplay.noActiveActor': 'No active actor',
    }[key] ?? key),
  }),
}));

import RoleplayManager from './RoleplayManager';

type Node = ReactElement<{
  children?: Node[] | Node | string;
  placeholder?: string;
  value?: string;
  onChange?: (event: { target: { value: string } }) => void;
  onClick?: () => void;
  disabled?: boolean;
}>;

function descendants(node: unknown): Node[] {
  if (!node || typeof node !== 'object') return [];
  const element = node as Node;
  const children = element.props?.children;
  const childNodes = Array.isArray(children) ? children : children ? [children] : [];
  return [element, ...childNodes.flatMap(descendants)];
}

function textContent(node: unknown): string {
  if (typeof node === 'string') return node;
  if (!node || typeof node !== 'object') return '';
  const children = (node as Node).props?.children;
  return (Array.isArray(children) ? children : [children]).map(textContent).join('');
}

function render(actorOptions = [{ actor: { type: 'llm' as const, ref: 'grok' }, label: 'Grok', shiftId: 'shift', queue: 'chatter' }], canEdit = true) {
  harness.index = 0;
  return descendants(RoleplayManager({
    modelId: 'model',
    actorOptions,
    canEdit,
  }));
}

function button(label: string) {
  return render().find(node => node.type === 'button' && textContent(node.props.children) === label);
}

function personaEditor() {
  return render().find(node => node.type === 'textarea' && node.props.placeholder === 'Write bounded character guidance…');
}

beforeEach(() => {
  harness.values = [];
  harness.index = 0;
  harness.effects = [];
});

afterEach(() => vi.unstubAllGlobals());

it('clicking the suggested personality action populates the persona editor', () => {
  harness.values[5] = true;
  expect(button('Use suggested personality')).toBeDefined();
  button('Use suggested personality')!.props.onClick!();

  expect(harness.values[6]).toBe('suggested');
  expect(harness.values[3]).toContain('Be warm, playful, and attentive.');
  expect(personaEditor()?.props.value).toContain('Be warm, playful, and attentive.');
});

it('manual mode keeps the text editable instead of replacing it', () => {
  harness.values[5] = true;
  button('Use suggested personality')!.props.onClick!();
  button('Write manually')!.props.onClick!();
  personaEditor()!.props.onChange!({ target: { value: 'A custom character voice written by the operator.' } });

  expect(harness.values[6]).toBe('manual');
  expect(personaEditor()?.props.value).toBe('A custom character voice written by the operator.');
});

it('allows a new persona revision to be saved without an active actor context', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = String(input);
    if (path.endsWith('/roleplay/persona') && init?.method === 'PUT') {
      const request = JSON.parse(String(init.body)) as { expectedRevision: number; content: string };
      return new Response(JSON.stringify({ data: {
        revision: request.expectedRevision + 1,
        source: 'soul.md',
        sourceRef: 'soul.md',
        content: request.content,
      } }), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    if (path.endsWith('/roleplay/persona')) return new Response(null, { status: 404 });
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  render([], true);
  expect(button('Reload bounded context')?.props.disabled).toBe(true);
  expect(button('Save new persona revision')?.props.disabled).toBe(true);
  expect(personaEditor()?.props.disabled).toBe(true);

  const initialEffects = harness.effects.splice(0);
  for (const effect of initialEffects) effect();
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(personaEditor()?.props.disabled).toBe(false);
  personaEditor()?.props.onChange?.({ target: { value: 'A playful, mischievous charmer.' } });
  expect(button('Save new persona revision')?.props.disabled).toBe(false);
  button('Save new persona revision')?.props.onClick?.();
  await new Promise(resolve => setTimeout(resolve, 0));

  const saveCall = fetchMock.mock.calls.find(([input, init]) =>
    String(input).endsWith('/roleplay/persona') && init?.method === 'PUT');
  expect(saveCall).toBeDefined();
  expect(JSON.parse(String(saveCall?.[1]?.body))).toMatchObject({
    expectedRevision: 0,
    sourceRef: 'soul.md',
    content: 'A playful, mischievous charmer.',
  });
  expect(render([], true).some(node => node.type === 'p' && textContent(node.props.children) === 'Persona revision saved')).toBe(true);
});

it('loads the current persona revision without an actor and saves against that revision', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = String(input);
    if (path.endsWith('/roleplay/persona') && init?.method === 'PUT') {
      const request = JSON.parse(String(init.body)) as { expectedRevision: number; content: string };
      return new Response(JSON.stringify({ data: {
        revision: request.expectedRevision + 1,
        source: 'soul.md',
        sourceRef: 'soul.md',
        content: request.content,
      } }), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    if (path.endsWith('/roleplay/persona'))
      return new Response(JSON.stringify({ data: {
        revision: 3,
        source: 'soul.md',
        sourceRef: 'soul.md',
        content: 'Existing saved persona.',
      } }), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  render([], true);
  for (const effect of harness.effects.splice(0)) effect();
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(personaEditor()?.props.value).toBe('Existing saved persona.');
  personaEditor()?.props.onChange?.({ target: { value: 'Updated saved persona.' } });
  button('Save new persona revision')?.props.onClick?.();
  await new Promise(resolve => setTimeout(resolve, 0));

  const saveCall = fetchMock.mock.calls.find(([input, init]) =>
    String(input).endsWith('/roleplay/persona') && init?.method === 'PUT');
  expect(JSON.parse(String(saveCall?.[1]?.body))).toMatchObject({
    expectedRevision: 3,
    sourceRef: 'soul.md',
    content: 'Updated saved persona.',
  });
  expect(render([], true).some(node => node.type === 'p' && textContent(node.props.children) === 'Persona revision saved')).toBe(true);
});
