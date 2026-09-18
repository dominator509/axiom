import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import RoleplayManager from './RoleplayManager';

it('exposes suggested and manual persona authoring controls', () => {
  const html = renderToStaticMarkup(<RoleplayManager modelId="model" actorOptions={[{ actor: { type: 'llm', ref: 'grok' }, label: 'Grok', shiftId: 'shift', queue: 'chatter' }]} canEdit />);
  expect(html).toContain('Persona authoring options');
  expect(html).toContain('Suggested personality');
  expect(html).toContain('Use suggested personality');
  expect(html).toContain('Write manually');
  expect(html).toContain('suggestions are editable guidance only');
});
