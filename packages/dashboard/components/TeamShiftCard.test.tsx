import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TeamShiftCard from './TeamShiftCard';
import LocaleProvider from './LocaleProvider';
const shift = { id: 's', modelId: 'm', assigneeUserId: 'u', assigneeType: 'human' as const, assigneeAgentRef: null, queue: 'inbox', startsAt: '2030-01-01T00:00:00Z', endsAt: '2030-01-01T08:00:00Z', status: 'active', note: 'Pending conversation needs follow-up' };
it('shows active shift status, existing context and completion handoff editor', () => {
  const html = renderToStaticMarkup(<TeamShiftCard shift={shift} assignee="Operator" canEdit disabled={false} onUpdate={vi.fn()} />);
  expect(html).toContain('active'); expect(html).toContain('Pending conversation');
  expect(html).toContain('Handoff for the next operator'); expect(html).toContain('Complete shift and save handoff');
});
it.each(['completed', 'cancelled'])('preserves readable handoff but no controls for %s shifts', status => {
  const html = renderToStaticMarkup(<TeamShiftCard shift={{ ...shift, status }} assignee="Operator" canEdit disabled={false} onUpdate={vi.fn()} />);
  expect(html).toContain('Pending conversation'); expect(html).not.toContain('<button'); expect(html).not.toContain('<textarea');
});
it('does not expose editing to read-only members', () => {
  expect(renderToStaticMarkup(<TeamShiftCard shift={shift} assignee="Operator" canEdit={false} disabled={false} onUpdate={vi.fn()} />)).not.toContain('<button');
});
it('renders team controls and timestamps through the selected locale', () => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale="es"><TeamShiftCard shift={shift} assignee="Operador" canEdit disabled={false} onUpdate={vi.fn()} /></LocaleProvider>);
  expect(html).toContain('Entrega para el siguiente operador');
  expect(html).toContain('Completar turno y guardar entrega');
  expect(html).toContain('UTC');
  expect(html).not.toContain('Handoff for the next operator');
});
