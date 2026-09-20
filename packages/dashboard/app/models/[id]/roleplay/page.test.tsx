import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = vi.hoisted(() => ({ session: vi.fn(), myShifts: vi.fn(), teamOperations: vi.fn() }));

vi.mock('@/lib/api', () => ({
  getSession: mocks.session,
  api: { myShifts: mocks.myShifts, models: { teamOperations: mocks.teamOperations } },
}));
vi.mock('@/components/RoleplayManager', () => ({
  default: ({ actorOptions }: { actorOptions: Array<{ label: string }> }) => <p>Actors: {actorOptions.map(option => option.label).join(', ')}</p>,
}));

import Page from './page';

const activeShift = {
  id: 'shift-1', modelId: 'model-1', modelName: 'Talent', queue: 'inbox',
  startsAt: '2030-01-01T00:00:00Z', endsAt: '2030-01-01T08:00:00Z', status: 'active', note: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 'chatter-1', email: 'chatter@example.test', name: 'Alex', role: 'chatter' } });
  mocks.myShifts.mockResolvedValue({ data: [activeShift], meta: { next_cursor: null } });
});

it('uses the chatter-owned shift roster instead of the administrative team endpoint', async () => {
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'model-1' }) }));
  expect(mocks.myShifts).toHaveBeenCalledOnce();
  expect(mocks.teamOperations).not.toHaveBeenCalled();
  expect(html).toContain('Human chatter · Alex');
});

it('keeps management roleplay actor discovery on the team operations endpoint', async () => {
  mocks.session.mockResolvedValue({ user: { id: 'operator-1', email: 'operator@example.test', name: 'Operator', role: 'operator' } });
  mocks.teamOperations.mockResolvedValue({ data: {
    members: [{ id: 'operator-1', email: 'operator@example.test', role: 'operator' }],
    shifts: [{ id: 'shift-2', modelId: 'model-1', assigneeType: 'llm', assigneeAgentRef: 'grok', assigneeUserId: null, queue: 'inbox', status: 'active' }],
    shiftsMeta: { next_cursor: null }, notes: [], notesMeta: { next_cursor: null },
    agentPermissions: [{ id: 'permission-1', agentRef: 'grok', tier: 'roleplay', canEdit: true, canPublish: false }],
  } });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'model-1' }) }));
  expect(mocks.teamOperations).toHaveBeenCalledWith('model-1');
  expect(mocks.myShifts).not.toHaveBeenCalled();
  expect(html).toContain('LLM · grok');
});
