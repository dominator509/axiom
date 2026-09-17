'use client';

import { useRef, useState } from 'react';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';

const roles = ['owner', 'manager', 'operator', 'analyst'] as const;
type Role = typeof roles[number];
interface Member { id: string; name: string; email: string; role: string }
const descriptions: Record<Role, string> = {
  owner: 'Workspace administration, member access, and operational controls.',
  manager: 'Manage talent operations without owner-only workspace controls.',
  operator: 'Run day-to-day content and publishing operations.',
  analyst: 'Review reporting; operational changes remain subject to API permissions.',
};
export function isMember(value: unknown): value is Member {
  if (!value || typeof value !== 'object') return false;
  const item = value as Member;
  return typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 200
    && typeof item.name === 'string' && typeof item.email === 'string'
    && typeof item.role === 'string' && item.role.length > 0;
}

export function MemberRoleCard({ member, onSaved }: { member: Member; onSaved: () => void }) {
  const [role, setRole] = useState(member.role);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [finished, setFinished] = useState(false);
  const lock = useRef(false);
  const intent = useRef<{ key: string; body: string; role: string } | null>(null);
  async function save() {
    if (lock.current || finished || !confirm || !roles.includes(role as Role) || role === member.role) return;
    lock.current = true; setBusy(true); setMessage('');
    intent.current ??= { key: createIdempotencyKey(), body: JSON.stringify({ expectedRole: member.role, role }), role };
    const current = intent.current;
    try {
      const response = await mutationFetch(`/api/v1/members/${encodeURIComponent(member.id)}/role`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: current.body,
      }, { idempotencyKey: current.key, retries: 0 });
      if (!response.ok) {
        const details = await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) { setFinished(true); intent.current = null; }
        setMessage(details?.error?.message ?? 'Change not confirmed. Reload members before another edit.');
        return;
      }
      const result = await readDashboardJson<{ data?: { id: string; role: string; sessionsRevoked: boolean } }>(response);
      if (result.data?.id !== member.id || result.data.role !== current.role || typeof result.data.sessionsRevoked !== 'boolean') throw new Error('invalid receipt');
      intent.current = null; setFinished(true);
      setMessage('Role saved. Changed members must sign in again. Reload members to see current access.');
      onSaved();
    } catch { setMessage('Save not confirmed. Retry the same change or reload members to inspect current access.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <article className="card stack">
    <h2>{member.name || member.email}</h2><p style={{ overflowWrap: 'anywhere' }}>{member.email}</p><p>Current role: {member.role}</p>
    <label>New role<select value={role} disabled={busy || finished || confirm} onChange={event => setRole(event.target.value)}>
      {!roles.includes(member.role as Role) && <option value={member.role}>{member.role} (not assignable)</option>}
      {roles.map(value => <option key={value} value={value}>{value}</option>)}
    </select></label>
    {roles.includes(role as Role) && <p className="subtle">{descriptions[role as Role]}</p>}
    {!confirm && !finished && <button className="btn secondary" type="button" disabled={role === member.role || !roles.includes(role as Role)} onClick={() => setConfirm(true)}>Review role change</button>}
    {confirm && !finished && <div className="stack"><p>Change {member.email} from {member.role} to {role}? This ends their existing sessions. Changing your own role also signs you out. The last workspace owner cannot be removed.</p><div className="action-row">
      <button className="btn" type="button" disabled={busy} onClick={() => void save()}>{intent.current ? 'Retry same role change' : 'Confirm role change'}</button>
      {!intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>}
    </div></div>}
    {message && <p role="status">{message}</p>}
  </article>;
}

export default function WorkspaceMembers() {
  const [members, setMembers] = useState<Member[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  async function load(older = false) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/v1/members${older && cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('unavailable');
      const result = await readDashboardJson<{ data?: unknown; meta?: { next_cursor?: unknown; assignable_roles?: unknown } }>(response);
      if (!Array.isArray(result.data) || !result.data.every(isMember) || !result.meta
        || !(result.meta.next_cursor === null || typeof result.meta.next_cursor === 'string')
        || JSON.stringify(result.meta.assignable_roles) !== JSON.stringify(roles)) throw new Error('invalid members');
      const rows = result.data as Member[];
      setMembers(previous => older ? [...previous, ...rows.filter(item => !previous.some(existing => existing.id === item.id))] : rows);
      setCursor(result.meta.next_cursor as string | null); setLoaded(true);
      if (!older) setRevision(value => value + 1);
    } catch { setMessage('Members could not be loaded. Your session may have expired or owner access changed. Sign in again if needed.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="stack"><p className="subtle">Changes are audited. Scoped Chatter, Content Creator and Model role activation is not yet available here.</p>
    <button className="btn secondary" type="button" disabled={busy} onClick={() => void load()}>Reload members</button>
    {message && <p role="status">{message}</p>}
    {loaded && members.length === 0 && <p>No workspace members returned.</p>}
    <div className="stack">{members.map(member => <MemberRoleCard key={`${revision}:${member.id}`} member={member} onSaved={() => setMessage('Member access changed. Reload members; if you changed your own role, sign in again.')} />)}</div>
    {cursor && <button className="btn secondary" type="button" disabled={busy} onClick={() => void load(true)}>Load more members</button>}
  </div>;
}
