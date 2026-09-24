import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, send: vi.fn(), fetch: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = hooks.index++;
    if (!(i in hooks.slots)) hooks.slots[i] = initial;
    return [hooks.slots[i], (value: unknown) => { hooks.slots[i] = typeof value === 'function' ? value(hooks.slots[i]) : value; }];
  },
  useRef: (initial: unknown) => {
    const i = hooks.index++;
    return hooks.slots[i] ??= { current: initial };
  },
}));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: () => 'assignment-intent', mutationFetch: hooks.send }));
vi.mock('./LocaleProvider', () => ({ useLocale: () => ({ locale: 'en', t: (key: string, values?: Record<string, string | number>) => {
  const messages: Record<string, string> = {
    'team.loadAssignments': 'Load assignments',
    'team.assignmentLoadFailed': 'Assignments could not be loaded. No access changes were made. Try loading again.',
    'team.assignmentRejected': 'Assignment request was rejected. Check your selection.',
    'team.assignmentChangeUnconfirmed': 'Assignment change was not confirmed. Retry the same change; do not submit another.',
    'team.assignmentSaved': 'Model assignment saved. The account role was not changed.',
    'team.assignmentRemoved': 'Model assignment removed. Existing workspace-wide roles are unchanged.',
    'team.retryAssignmentChange': 'Retry same assignment change',
    'team.assignmentsAria': 'Model team assignments',
    'team.assignmentsTitle': 'Model team assignments',
    'team.assignmentsDescription': 'Owner-managed membership for this talent.',
    'team.noAssignments': 'No team members assigned to this talent.',
    'team.assignedAt': 'Assigned {value}',
    'team.removeAssignment': 'Remove assignment',
    'team.confirmRemoveAssignment': 'Remove this talent assignment for {name}?',
    'team.confirmRemoval': 'Confirm removal',
    'team.keepAssignment': 'Keep assignment',
    'team.assignMember': 'Assign a workspace member',
    'team.teamMember': 'Team member',
    'team.selectMember': 'Select a member',
    'team.assignToTalent': 'Assign to talent',
    'team.loadMoreAssignments': 'Load more assignments',
  };
  return messages[key]?.replace('{name}', String(values?.name ?? '')).replace('{value}', String(values?.value ?? '')) ?? key;
} }) }));
import ModelAssignments, { validAssignment } from './ModelAssignments';
const modelId = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const member = { id: 'user', email: 'person@example.invalid', role: 'operator' };
const grant = { id, modelId, userId: member.id, createdAt: '2026-01-01T00:00:00Z' };
interface Node { type: unknown; props: { children?: unknown; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void; disabled?: boolean; role?: string } }
function find(value: unknown, type: string, text?: string): Node | undefined {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const child of value) { const node = find(child, type, text); if (node) return node; } return; }
  const node = value as Node;
  if (node.type === type && (text === undefined || node.props.children === text)) return node;
  return find(node.props?.children, type, text);
}
function render() { hooks.index = 0; return ModelAssignments({ modelId, members: [member] }); }
function click(text: string) { const button = find(render(), 'button', text); expect(button).toBeDefined(); button!.props.onClick!(); }
async function load(data: unknown[] = []) {
  hooks.fetch.mockResolvedValueOnce(Response.json({ data, meta: { next_cursor: null } }));
  click('Load assignments');
  await vi.waitFor(() => expect(find(render(), 'fieldset')!.props.disabled).toBe(false));
}
beforeEach(() => { hooks.slots = []; hooks.index = 0; hooks.send.mockReset(); hooks.fetch.mockReset(); vi.stubGlobal('fetch', hooks.fetch); });
afterEach(() => vi.unstubAllGlobals());

it('validates assignment identity and fails closed until a successful scoped load', async () => {
  expect(validAssignment(grant, modelId)).toBe(true);
  for (const invalid of [{ ...grant, modelId: 'other' }, { ...grant, id: 'invalid' }, { ...grant, createdAt: 'invalid' }, { ...grant, userId: '' }]) expect(validAssignment(invalid, modelId)).toBe(false);
  hooks.fetch.mockResolvedValueOnce(Response.json({ data: [{ ...grant, modelId: 'other' }], meta: { next_cursor: null } }));
  click('Load assignments');
  await vi.waitFor(() => expect(find(render(), 'p', 'Assignments could not be loaded. No access changes were made. Try loading again.')).toBeDefined());
  expect(find(render(), 'fieldset')!.props.disabled).toBe(true);
  expect(hooks.send).not.toHaveBeenCalled();
});
it('deduplicates double clicks and retains exact grant intent after a lost response', async () => {
  await load();
  find(render(), 'select')!.props.onChange!({ target: { value: member.id } });
  let reject!: (reason: Error) => void;
  hooks.send.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  click('Assign to talent'); click('Assign to talent');
  expect(hooks.send).toHaveBeenCalledTimes(1);
  reject(new Error('Lost response'));
  await vi.waitFor(() => expect(find(render(), 'button', 'Retry same assignment change')!.props.disabled).toBe(false));
  expect(find(render(), 'fieldset')!.props.disabled).toBe(true);
  hooks.send.mockResolvedValueOnce(Response.json({ data: grant }));
  click('Retry same assignment change');
  await vi.waitFor(() => expect(find(render(), 'button', 'Retry same assignment change')).toBeUndefined());
  expect(hooks.send.mock.calls[1]).toEqual(hooks.send.mock.calls[0]);
  expect(JSON.parse(hooks.send.mock.calls[0][1].body)).toEqual({ userId: member.id });
  expect(find(render(), 'button', 'Remove assignment')).toBeDefined();
});
it('requires explicit removal confirmation and validates the exact revocation receipt', async () => {
  await load([grant]);
  click('Remove assignment');
  expect(hooks.send).not.toHaveBeenCalled();
  click('Keep assignment');
  expect(find(render(), 'button', 'Confirm removal')).toBeUndefined();
  click('Remove assignment');
  hooks.send.mockResolvedValueOnce(Response.json({ data: { id: modelId, revoked: true } }));
  click('Confirm removal');
  await vi.waitFor(() => expect(find(render(), 'button', 'Retry same assignment change')!.props.disabled).toBe(false));
  hooks.send.mockResolvedValueOnce(Response.json({ data: { id, revoked: true } }));
  click('Retry same assignment change');
  await vi.waitFor(() => expect(find(render(), 'button', 'Confirm removal')).toBeUndefined());
  expect(hooks.send.mock.calls[1]).toEqual(hooks.send.mock.calls[0]);
  expect(hooks.send.mock.calls[0][0]).toBe(`/api/v1/models/${modelId}/member-assignments/${id}`);
  expect(hooks.send.mock.calls[0][1].method).toBe('DELETE');
});
