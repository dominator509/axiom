'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TeamMember, TeamNote, TeamShift } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import TeamShiftCard from './TeamShiftCard';

export default function TeamOperationsManager({ modelId, members, shifts, notes, canEdit }: { modelId: string; members: TeamMember[]; shifts: TeamShift[]; notes: TeamNote[]; canEdit: boolean }) {
  const router = useRouter();
  const [assigneeUserId, setAssigneeUserId] = useState(members[0]?.id ?? '');
  const [queue, setQueue] = useState('inbox');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [note, setNote] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const intent = useRef<{ path: string; body: string; key: string; method: 'POST' | 'PATCH' } | null>(null);

  async function send(path: string, nextBody: Record<string, unknown>, success?: () => void, method: 'POST' | 'PATCH' = 'POST') {
    if (!canEdit || busy) return;
    intent.current ??= { path, body: JSON.stringify(nextBody), key: createIdempotencyKey(), method };
    setBusy(true); setError('');
    try {
      const response = await mutationFetch(intent.current.path, { method: intent.current.method, headers: { 'content-type': 'application/json' }, body: intent.current.body }, { idempotencyKey: intent.current.key, retries: 0 });
      if (!response.ok) { const details = await readDashboardError(response); setError(details?.error?.message ?? 'Team change was not accepted.'); if ([400, 401, 403, 404, 409, 422].includes(response.status)) intent.current = null; return; }
      const result = await readDashboardJson<{ data?: unknown }>(response); if (!result.data) throw new Error('unconfirmed team response');
      intent.current = null; success?.(); router.refresh();
    } catch { setError('Team change was not confirmed. Retry the same intent.'); }
    finally { setBusy(false); }
  }

  function saveShift() {
    if (!assigneeUserId || !startsAt || !endsAt) { setError('Choose a team member and both shift times.'); return; }
    void send(`/api/v1/models/${encodeURIComponent(modelId)}/team-shifts`, { assigneeUserId, queue, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), note });
  }
  function saveNote() { if (!body.trim()) { setError('Enter a note.'); return; } void send(`/api/v1/models/${encodeURIComponent(modelId)}/team-notes`, { body: body.trim() }, () => setBody('')); }
  function updateShift(shift: TeamShift, status: string, note?: string) { void send(`/api/v1/models/${encodeURIComponent(modelId)}/team-shifts/${encodeURIComponent(shift.id)}`, { status, ...(note === undefined ? {} : { note }) }, undefined, 'PATCH'); }

  return <div className="stack">
    <p className="subtle">Shifts assign a human queue; notes are internal workspace records. These controls do not grant provider, network, or publishing access.</p>
    {shifts.length > 0 && <div className="stack">{shifts.map(shift => <TeamShiftCard key={`${shift.id}:${shift.status}:${shift.note}`} shift={shift} assignee={members.find(member => member.id === shift.assigneeUserId)?.email ?? shift.assigneeUserId} canEdit={canEdit} disabled={busy || !!intent.current} onUpdate={(status, note) => updateShift(shift, status, note)} />)}</div>}
    {canEdit && <fieldset className="stack" disabled={busy || intent.current !== null} style={{ border: 0, padding: 0, minWidth: 0 }}><legend>Schedule a shift</legend><div className="row"><label>Team member<select value={assigneeUserId} onChange={event => setAssigneeUserId(event.target.value)}>{members.map(member => <option key={member.id} value={member.id}>{member.email} · {member.role}</option>)}</select></label><label>Queue<input value={queue} onChange={event => setQueue(event.target.value)} maxLength={100} /></label></div><div className="row"><label>Starts<input type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label><label>Ends<input type="datetime-local" value={endsAt} onChange={event => setEndsAt(event.target.value)} /></label></div><label>Shift note<input value={note} onChange={event => setNote(event.target.value)} maxLength={2000} /></label><button className="btn" type="button" onClick={saveShift}>Schedule shift</button></fieldset>}
    {canEdit && <fieldset className="stack" disabled={busy || intent.current !== null} style={{ border: 0, padding: 0, minWidth: 0 }}><legend>Add internal note</legend><textarea value={body} onChange={event => setBody(event.target.value)} maxLength={4000} placeholder="Visible to this workspace team only" /><button className="btn secondary" type="button" onClick={saveNote}>Save internal note</button></fieldset>}
    {intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => { const current = intent.current; if (current) void send(current.path, JSON.parse(current.body), undefined, current.method); }}>Retry same team change</button>}
    {notes.length > 0 && <div className="stack"><h3>Recent notes</h3>{notes.map(item => <article className="card" key={item.id}><p>{item.body}</p><span className="subtle">{new Date(item.createdAt).toLocaleString()}</span></article>)}</div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
