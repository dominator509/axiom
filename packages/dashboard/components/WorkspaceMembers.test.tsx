import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, send: vi.fn(), fetch: vi.fn(), saved: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = hooks.index++; if (!(i in hooks.slots)) hooks.slots[i] = initial;
    return [hooks.slots[i], (value: unknown) => { hooks.slots[i] = typeof value === 'function' ? value(hooks.slots[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = hooks.index++; return hooks.slots[i] ??= { current: initial }; },
}));
vi.mock('@/lib/mutation', () => ({ mutationFetch: hooks.send, createIdempotencyKey: () => 'stable-intent' }));
vi.mock('./LocaleProvider', () => ({ useLocale: () => ({
  locale: 'en',
  setLocale: vi.fn(),
  t: (key: string, values?: Record<string, string | number>) => {
    const messages: Record<string, string> = {
      'members.auditNote': 'Changes are audited. Content Creators, Models and Chatters need talent assignments from the talent’s Team page. Chatters also need an active shift before talent or inbox access is available.',
      'members.reload': 'Reload members',
      'members.loadMore': 'Load more members',
      'members.empty': 'No workspace members returned.',
      'members.loadFailed': 'Members could not be loaded.',
      'members.currentRole': 'Current role: {role}',
      'members.newRole': 'New role',
      'members.notAssignable': '{role} (not assignable)',
      'members.review': 'Review role change',
      'members.confirmation': 'Change {email} from {from} to {to}?',
      'members.retry': 'Retry same role change',
      'members.confirm': 'Confirm role change',
      'members.cancel': 'Cancel',
      'members.saved': 'Role saved.',
      'members.accessChanged': 'Member access changed.',
      'members.rejected': 'Change not confirmed.',
      'members.notConfirmed': 'Save not confirmed.',
      'members.role.owner': 'Owner',
      'members.role.manager': 'Manager',
      'members.role.operator': 'Operator',
      'members.role.analyst': 'Analyst',
      'members.role.content_creator': 'Content Creator',
      'members.role.model': 'Model',
      'members.role.chatter': 'Chatter',
      'members.roleDescription.owner': 'Workspace administration.',
      'members.roleDescription.manager': 'Manage talent operations.',
      'members.roleDescription.operator': 'Run content operations.',
      'members.roleDescription.analyst': 'Review reporting.',
      'members.roleDescription.content_creator': 'Prepare assigned talent content.',
      'members.roleDescription.model': 'Read assigned talent data.',
      'members.roleDescription.chatter': 'Work assigned inboxes during shifts.',
    };
    return (messages[key] ?? key).replace(/\{([a-z]+)\}/g, (_, name: string) => String(values?.[name] ?? `{${name}}`));
  },
}) }));
import WorkspaceMembers, { MemberRoleCard, isMember } from './WorkspaceMembers';
const member = { id: 'user/one', name: 'One', email: 'one@example.test', role: 'operator' };
const roles = ['owner', 'manager', 'operator', 'analyst', 'content_creator', 'model', 'chatter'];
interface Node { type: unknown; props: { children?: unknown; disabled?: boolean; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void } }
function find(value: unknown, type: unknown, text?: string): Node | undefined {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) { const found = find(item, type, text); if (found) return found; } return; }
  const node = value as Node;
  if (node.type === type && (text === undefined || node.props.children === text)) return node;
  return find(node.props?.children, type, text);
}
function card() { hooks.index = 0; return MemberRoleCard({ member, onSaved: hooks.saved }); }
function list() { hooks.index = 0; return WorkspaceMembers(); }
function click(text: string) { const button = find(card(), 'button', text); expect(button).toBeDefined(); button!.props.onClick!(); }
function choose() { find(card(), 'select')!.props.onChange!({ target: { value: 'analyst' } }); click('Review role change'); }
beforeEach(() => { hooks.slots = []; hooks.index = 0; hooks.send.mockReset(); hooks.fetch.mockReset(); hooks.saved.mockReset(); vi.stubGlobal('fetch', hooks.fetch); });
afterEach(() => vi.unstubAllGlobals());
it('requires confirmation and fences repeated clicks until the exact receipt arrives', async () => {
  expect(find(card(), 'button', 'Review role change')!.props.disabled).toBe(true);
  choose();
  let resolve!: (response: Response) => void;
  hooks.send.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const confirm = find(card(), 'button', 'Confirm role change')!;
  confirm.props.onClick!(); confirm.props.onClick!();
  expect(hooks.send).toHaveBeenCalledOnce();
  expect(hooks.send.mock.calls[0][0]).toBe('/api/v1/members/user%2Fone/role');
  expect(JSON.parse(hooks.send.mock.calls[0][1].body)).toEqual({ expectedRole: 'operator', role: 'analyst' });
  resolve(Response.json({ data: { id: member.id, role: 'analyst', sessionsRevoked: true } }));
  await vi.waitFor(() => expect(hooks.saved).toHaveBeenCalledOnce());
  expect(find(card(), 'select')!.props.disabled).toBe(true);
});
it.each(['content_creator', 'model', 'chatter'])('confirms and saves scoped role %s through the member API', async role => {
  find(card(), 'select')!.props.onChange!({ target: { value: role } });
  click('Review role change');
  hooks.send.mockResolvedValueOnce(Response.json({ data: { id: member.id, role, sessionsRevoked: true } }));
  click('Confirm role change');
  await vi.waitFor(() => expect(hooks.saved).toHaveBeenCalledOnce());
  expect(JSON.parse(hooks.send.mock.calls[0][1].body)).toEqual({ expectedRole: 'operator', role });
});
it('preserves the exact key and payload after a lost response or mismatched receipt', async () => {
  choose(); hooks.send.mockRejectedValueOnce(new Error('lost')); click('Confirm role change');
  await vi.waitFor(() => expect(find(card(), 'button', 'Retry same role change')!.props.disabled).toBe(false));
  expect(find(card(), 'button', 'Cancel')).toBeUndefined();
  hooks.send.mockResolvedValueOnce(Response.json({ data: { id: 'wrong-user', role: 'analyst', sessionsRevoked: true } }));
  click('Retry same role change');
  await vi.waitFor(() => expect(find(card(), 'button', 'Retry same role change')!.props.disabled).toBe(false));
  expect(hooks.send.mock.calls[0]).toEqual(hooks.send.mock.calls[1]);
  expect(hooks.saved).not.toHaveBeenCalled();
});
it.each([401, 403, 409])('requires reloading after a terminal %s rather than resubmitting a stale edit', async status => {
  choose(); hooks.send.mockResolvedValueOnce(Response.json({ error: { message: 'Reload required' } }, { status })); click('Confirm role change');
  await vi.waitFor(() => expect(find(card(), 'button', 'Confirm role change')).toBeUndefined());
  expect(find(card(), 'select')!.props.disabled).toBe(true);
});
it('validates paginated discovery before rendering edit controls', async () => {
  expect(isMember(member)).toBe(true); expect(isMember({ ...member, id: '' })).toBe(false);
  hooks.fetch.mockResolvedValueOnce(Response.json({ data: [member], meta: { next_cursor: 'user/one', assignable_roles: roles } }));
  find(list(), 'button', 'Reload members')!.props.onClick!();
  await vi.waitFor(() => expect(find(list(), 'button', 'Load more members')).toBeDefined());
  hooks.fetch.mockResolvedValueOnce(Response.json({ data: [], meta: { next_cursor: null, assignable_roles: roles } }));
  find(list(), 'button', 'Load more members')!.props.onClick!();
  await vi.waitFor(() => expect(find(list(), 'button', 'Load more members')).toBeUndefined());
  expect(hooks.fetch.mock.calls[1][0]).toBe('/api/v1/members?cursor=user%2Fone');
  expect(find(list(), MemberRoleCard)).toBeDefined();
});
it('does not offer controls from an invalid response', async () => {
  hooks.fetch.mockResolvedValueOnce(Response.json({ data: [member], meta: { next_cursor: null, assignable_roles: ['owner', 'superuser'] } }));
  find(list(), 'button', 'Reload members')!.props.onClick!();
  await vi.waitFor(() => expect(find(list(), 'button', 'Reload members')!.props.disabled).toBe(false));
  expect(find(list(), MemberRoleCard)).toBeUndefined();
});
