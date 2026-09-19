import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TeamOperationsManager from './TeamOperationsManager';
import LocaleProvider from './LocaleProvider';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const shift = {
  id: 'shift-1', modelId: 'model-1', assigneeUserId: 'user-1', assigneeType: 'human' as const,
  assigneeAgentRef: null, queue: 'inbox', startsAt: '2030-01-01T00:00:00Z', endsAt: '2030-01-01T08:00:00Z',
  status: 'scheduled', note: 'Keep the handoff concise',
};
const props = {
  modelId: 'model-1',
  members: [{ id: 'user-1', email: 'operator@example.test', role: 'operator' }],
  shifts: [shift], shiftsMeta: { next_cursor: 'shift-next' },
  notes: [{ id: 'note-1', modelId: 'model-1', authorUserId: 'user-1', targetType: 'model', targetId: null, body: 'Internal handoff', createdAt: '2030-01-01T04:00:00Z' }],
  notesMeta: { next_cursor: 'note-next' },
  agentPermissions: [{ id: 'permission-1', agentRef: 'grok-roleplayer', tier: 'roleplay', canEdit: true, canPublish: false }],
  canEdit: true,
};

it('localizes team operations controls while preserving authored notes and UTC display', () => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale="es"><TeamOperationsManager {...props} /></LocaleProvider>);
  expect(html).toContain('Los turnos pueden asignarse');
  expect(html).toContain('Programar turno');
  expect(html).toContain('Tipo de actor');
  expect(html).toContain('Cargar turnos anteriores');
  expect(html).toContain('Notas recientes');
  expect(html).toContain('Keep the handoff concise');
  expect(html).toContain('UTC');
  expect(html).not.toContain('Schedule a shift');
});

it('does not expose mutation controls to read-only viewers', () => {
  const html = renderToStaticMarkup(<TeamOperationsManager {...props} canEdit={false} />);
  expect(html).not.toContain('Schedule shift');
  expect(html).not.toContain('Add internal note');
  expect(html).toContain('Internal handoff');
});
