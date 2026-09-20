import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LocaleProvider from './LocaleProvider';
import RoleplayManager from './RoleplayManager';

it('exposes suggested and manual persona authoring controls', () => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale="en"><RoleplayManager modelId="model" actorOptions={[{ actor: { type: 'llm', ref: 'grok' }, label: 'Grok', shiftId: 'shift', queue: 'chatter' }]} canEdit /></LocaleProvider>);
  expect(html).toContain('Persona authoring options');
  expect(html).toContain('Suggested personality');
  expect(html).toContain('Use suggested personality');
  expect(html).toContain('Write manually');
  expect(html).toContain('suggestions are editable guidance only');
});

it('renders the same roleplay controls through the Spanish catalog', () => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale="es"><RoleplayManager modelId="model" actorOptions={[{ actor: { type: 'llm', ref: 'grok' }, label: 'Grok', shiftId: 'shift', queue: 'chatter' }]} canEdit /></LocaleProvider>);
  expect(html).toContain('Chatter y roleplay');
  expect(html).toContain('Personalidad sugerida');
  expect(html).toContain('Usar personalidad sugerida');
  expect(html).not.toContain('Suggested personality');
});
