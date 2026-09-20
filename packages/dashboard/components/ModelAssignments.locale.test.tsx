import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LocaleProvider from './LocaleProvider';
import ModelAssignments from './ModelAssignments';

const members = [{ id: 'member', email: 'persona@example.invalid', role: 'operator' }];

it('renders model assignment controls from the persisted Spanish catalog', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="es">
      <ModelAssignments modelId="11111111-1111-4111-8111-111111111111" members={members} />
    </LocaleProvider>,
  );
  expect(html).toContain('Asignaciones del equipo del modelo');
  expect(html).toContain('Cargar asignaciones');
  expect(html).toContain('Asignar al talento');
  expect(html).not.toContain('Model team assignments');
});
