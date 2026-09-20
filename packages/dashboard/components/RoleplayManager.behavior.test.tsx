import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const harness = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));

vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = harness.index++;
    if (!(index in harness.values)) harness.values[index] = initial;
    return [harness.values[index], (value: unknown) => { harness.values[index] = value; }];
  },
  useEffect: () => undefined,
  useMemo: (factory: () => unknown) => factory(),
}));

vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    locale: 'en',
    setLocale: vi.fn(),
    t: (key: string) => ({
      'roleplay.useSuggested': 'Use suggested personality',
      'roleplay.writeManually': 'Write manually',
      'roleplay.personaPlaceholder': 'Write bounded character guidance…',
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

function render() {
  harness.index = 0;
  return descendants(RoleplayManager({
    modelId: 'model',
    actorOptions: [{ actor: { type: 'llm', ref: 'grok' }, label: 'Grok', shiftId: 'shift', queue: 'chatter' }],
    canEdit: true,
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
});

it('clicking the suggested personality action populates the persona editor', () => {
  expect(button('Use suggested personality')).toBeDefined();
  button('Use suggested personality')!.props.onClick!();

  expect(harness.values[4]).toBe('suggested');
  expect(harness.values[3]).toContain('Be warm, playful, and attentive.');
  expect(personaEditor()?.props.value).toContain('Be warm, playful, and attentive.');
});

it('manual mode keeps the text editable instead of replacing it', () => {
  button('Use suggested personality')!.props.onClick!();
  button('Write manually')!.props.onClick!();
  personaEditor()!.props.onChange!({ target: { value: 'A custom character voice written by the operator.' } });

  expect(harness.values[4]).toBe('manual');
  expect(personaEditor()?.props.value).toBe('A custom character voice written by the operator.');
});
