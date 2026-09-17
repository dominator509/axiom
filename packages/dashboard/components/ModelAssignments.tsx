'use client';
import { useRef, useState } from 'react';
import type { TeamMember } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardJson } from '@/lib/response';

interface Assignment { id: string; modelId: string; userId: string; createdAt: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validAssignment(value: unknown, modelId: string): value is Assignment {
  if (!value || typeof value !== 'object') return false;
  const row = value as Assignment;
  return typeof row.id === 'string' && uuid.test(row.id) && row.modelId === modelId
    && typeof row.userId === 'string' && row.userId.length > 0 && row.userId.length <= 200
    && typeof row.createdAt === 'string' && Number.isFinite(Date.parse(row.createdAt));
}
interface Intent { key: string; method: 'POST' | 'DELETE'; path: string; body?: string; userId: string; assignmentId?: string }

export default function ModelAssignments({ modelId, members }: { modelId: string; members: TeamMember[] }) {
  const [rows, setRows] = useState<Assignment[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState(''), [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const active = useRef(false), intent = useRef<Intent | null>(null);
  const path = `/api/v1/models/${encodeURIComponent(modelId)}/member-assignments`;
  const label = (id: string) => members.find(member => member.id === id)?.email ?? id;

  async function load(more: boolean) {
    if (active.current || intent.current) return;
    active.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(`${path}${more && cursor ? `?${new URLSearchParams({ cursor })}` : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('unavailable');
      const body = await readDashboardJson<{ data: unknown[]; meta: { next_cursor: string | null } }>(response);
      if (!Array.isArray(body.data) || body.data.length > 50 || !body.data.every(row => validAssignment(row, modelId))
        || !body.meta || (body.meta.next_cursor !== null && (typeof body.meta.next_cursor !== 'string' || !uuid.test(body.meta.next_cursor)))) throw new Error('invalid assignments');
      const received = body.data as Assignment[];
      setRows(previous => more ? [...previous, ...received].filter((row, i, all) => all.findIndex(item => item.id === row.id) === i) : received);
      setCursor(body.meta.next_cursor); setLoaded(true);
    } catch { setError('Assignments could not be loaded. No access changes were made. Try loading again.'); }
    finally { active.current = false; setBusy(false); }
  }

  async function save(next?: Omit<Intent, 'key'>) {
    if (active.current) return;
    if (!intent.current && next) intent.current = { ...next, key: createIdempotencyKey() };
    const current = intent.current;
    if (!current) return;
    active.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const response = await mutationFetch(current.path, { method: current.method, ...(current.body ? { headers: { 'content-type': 'application/json' }, body: current.body } : {}) }, { idempotencyKey: current.key, retries: 0 });
      if (!response.ok) {
        if ([400, 422].includes(response.status)) { intent.current = null; setError('Assignment request was rejected. Check your selection.'); }
        else setError('Assignment change was not confirmed. Retry the same change; do not submit another.');
        return;
      }
      const result = await readDashboardJson<{ data: unknown }>(response);
      if (current.method === 'POST') {
        if (!validAssignment(result.data, modelId) || result.data.userId !== current.userId) throw new Error('unconfirmed grant');
        const grant = result.data;
        setRows(previous => [grant, ...previous.filter(row => row.id !== grant.id)]);
        setUserId(''); setMessage('Model assignment saved. The account role was not changed.');
      } else {
        const receipt = result.data as { id?: unknown; revoked?: unknown } | null;
        if (!receipt || receipt.id !== current.assignmentId || receipt.revoked !== true) throw new Error('unconfirmed revoke');
        setRows(previous => previous.filter(row => row.id !== current.assignmentId));
        setMessage('Model assignment removed. Existing workspace-wide roles are unchanged.');
      }
      intent.current = null; setConfirm(null);
    } catch { setError('Assignment change was not confirmed. Retry the same change; do not submit another.'); }
    finally { active.current = false; setBusy(false); }
  }

  const locked = busy || !!intent.current;
  return <section className="card stack" aria-label="Model team assignments">
    <h3>Model team assignments</h3>
    <p className="subtle">Owner-managed membership for this talent. Content Creators, Models and Chatters need an assignment; Chatters also need an active shift. Assignments do not change roles or restrict workspace-wide roles. Manage roles on the Members page.</p>
    <div className="action-row"><button className="btn secondary" type="button" disabled={locked} onClick={() => void load(false)}>Load assignments</button></div>
    {loaded && rows.length === 0 && <p>No team members assigned to this talent.</p>}
    {rows.map(row => <article className="card stack" key={row.id}>
      <strong style={{ overflowWrap: 'anywhere' }}>{label(row.userId)}</strong>
      <span className="subtle">Assigned {new Date(row.createdAt).toLocaleString()}</span>
      {confirm === row.id ? <><p>Remove this talent assignment for {label(row.userId)}? This does not remove their account or change their workspace role.</p><div className="action-row"><button className="btn secondary" type="button" disabled={locked} onClick={() => void save({ path: `${path}/${encodeURIComponent(row.id)}`, method: 'DELETE', userId: row.userId, assignmentId: row.id })}>Confirm removal</button><button className="btn secondary" type="button" disabled={locked} onClick={() => setConfirm(null)}>Keep assignment</button></div></>
        : <button className="btn secondary" type="button" disabled={locked} onClick={() => setConfirm(row.id)}>Remove assignment</button>}
    </article>)}
    {cursor && <button className="btn secondary" type="button" disabled={locked} onClick={() => void load(true)}>Load more assignments</button>}
    <fieldset className="stack" disabled={locked || !loaded} style={{ border: 0, padding: 0, minWidth: 0 }}>
      <legend>Assign a workspace member</legend>
      <label>Team member<select value={userId} onChange={event => setUserId(event.target.value)}><option value="">Select a member</option>{members.map(member => <option value={member.id} key={member.id}>{member.email} · {member.role}</option>)}</select></label>
      <button className="btn" type="button" disabled={!userId} onClick={() => { if (members.some(member => member.id === userId)) void save({ path, method: 'POST', userId, body: JSON.stringify({ userId }) }); }}>Assign to talent</button>
    </fieldset>
    {intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => void save()}>Retry same assignment change</button>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </section>;
}
