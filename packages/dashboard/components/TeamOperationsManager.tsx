'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TeamAgentPermission, TeamMember, TeamNote, TeamShift } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import TeamShiftCard from './TeamShiftCard';

export default function TeamOperationsManager({ modelId, members, shifts, shiftsMeta, notes, notesMeta, agentPermissions, canEdit }: { modelId: string; members: TeamMember[]; shifts: TeamShift[]; shiftsMeta?: { next_cursor: string | null }; notes: TeamNote[]; notesMeta?: { next_cursor: string | null }; agentPermissions: TeamAgentPermission[]; canEdit: boolean }) {
  const router = useRouter();
  const [liveShifts, setLiveShifts] = useState(shifts);
  const [liveNotes, setLiveNotes] = useState(notes);
  const [shiftCursor, setShiftCursor] = useState(shiftsMeta?.next_cursor ?? null);
  const [noteCursor, setNoteCursor] = useState(notesMeta?.next_cursor ?? null);
  const [reading, setReading] = useState(false);
  const [assigneeUserId, setAssigneeUserId] = useState(members[0]?.id ?? '');
  const [assigneeType, setAssigneeType] = useState<'human' | 'llm'>('human');
  const [assigneeAgentRef, setAssigneeAgentRef] = useState(agentPermissions.find(permission => permission.canEdit)?.agentRef ?? '');
  const [queue, setQueue] = useState('inbox');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [note, setNote] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const intent = useRef<{ path: string; body: string; key: string; method: 'POST' | 'PATCH' } | null>(null);

  async function loadOlder(kind: 'shifts' | 'notes') {
    if (reading) return;
    const cursor = kind === 'shifts' ? shiftCursor : noteCursor;
    if (!cursor) return;
    setReading(true); setError('');
    try {
      const query = new URLSearchParams(kind === 'shifts' ? { shiftCursor: cursor } : { noteCursor: cursor });
      const response = await fetch(`/api/v1/models/${encodeURIComponent(modelId)}/team-operations?${query}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('team history unavailable');
      const result = await readDashboardJson<{ data?: { shifts?: unknown; shiftsMeta?: { next_cursor: string | null }; notes?: unknown; notesMeta?: { next_cursor: string | null } } }>(response);
      if (!result.data || !Array.isArray(result.data.shifts) || !Array.isArray(result.data.notes)
        || !result.data.shiftsMeta || !result.data.notesMeta) throw new Error('invalid team history');
      if (kind === 'shifts') {
        setLiveShifts(previous => [...new Map([...previous, ...result.data!.shifts as TeamShift[]].map(item => [item.id, item])).values()]);
        setShiftCursor(result.data.shiftsMeta.next_cursor);
      } else {
        setLiveNotes(previous => [...new Map([...previous, ...result.data!.notes as TeamNote[]].map(item => [item.id, item])).values()]);
        setNoteCursor(result.data.notesMeta.next_cursor);
      }
    } catch { setError(`Older ${kind} could not be loaded. Try again.`); }
    finally { setReading(false); }
  }

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
    if ((!assigneeUserId && assigneeType === 'human') || (!assigneeAgentRef && assigneeType === 'llm') || !startsAt || !endsAt) { setError('Choose an actor and both shift times.'); return; }
    void send(`/api/v1/models/${encodeURIComponent(modelId)}/team-shifts`, { assigneeType, ...(assigneeType === 'human' ? { assigneeUserId } : { assigneeAgentRef }), queue, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), note });
  }
  function saveNote() { if (!body.trim()) { setError('Enter a note.'); return; } void send(`/api/v1/models/${encodeURIComponent(modelId)}/team-notes`, { body: body.trim() }, () => setBody('')); }
  function updateShift(shift: TeamShift, status: string, note?: string) { void send(`/api/v1/models/${encodeURIComponent(modelId)}/team-shifts/${encodeURIComponent(shift.id)}`, { status, ...(note === undefined ? {} : { note }) }, undefined, 'PATCH'); }

  return <div className="stack">
    <p className="subtle">Shifts can assign a human or an approved, editable model-scoped LLM actor. Notes are internal workspace records. Neither actor type receives provider, network or publishing access from this screen.</p>
    {liveShifts.length > 0 && <div className="stack">{liveShifts.map(shift => <TeamShiftCard key={`${shift.id}:${shift.status}:${shift.note}`} shift={shift} assignee={shift.assigneeType === 'llm' ? `LLM · ${shift.assigneeAgentRef}` : (members.find(member => member.id === shift.assigneeUserId)?.email ?? shift.assigneeUserId ?? 'unknown actor')} canEdit={canEdit} disabled={busy || !!intent.current} onUpdate={(status, note) => updateShift(shift, status, note)} />)}</div>}
    {shiftCursor && <button className="btn secondary" type="button" disabled={reading || busy} onClick={() => void loadOlder('shifts')}>Load older shifts</button>}
    {canEdit && <fieldset className="stack" disabled={busy || intent.current !== null} style={{ border: 0, padding: 0, minWidth: 0 }}><legend>Schedule a shift</legend><div className="row"><label>Actor type<select value={assigneeType} onChange={event => setAssigneeType(event.target.value as 'human' | 'llm')}><option value="human">Human chatter</option><option value="llm" disabled={!agentPermissions.some(permission => permission.canEdit)}>Assigned LLM</option></select></label>{assigneeType === 'human' ? <label>Team member<select value={assigneeUserId} onChange={event => setAssigneeUserId(event.target.value)}>{members.map(member => <option key={member.id} value={member.id}>{member.email} · {member.role}</option>)}</select></label> : <label>LLM permission<select value={assigneeAgentRef} onChange={event => setAssigneeAgentRef(event.target.value)}><option value="">Select an editable actor</option>{agentPermissions.filter(permission => permission.canEdit).map(permission => <option key={permission.id} value={permission.agentRef}>{permission.agentRef} · {permission.tier}</option>)}</select></label>}<label>Queue<input value={queue} onChange={event => setQueue(event.target.value)} maxLength={100} /></label></div><div className="row"><label>Starts<input type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label><label>Ends<input type="datetime-local" value={endsAt} onChange={event => setEndsAt(event.target.value)} /></label></div><label>Shift note<input value={note} onChange={event => setNote(event.target.value)} maxLength={2000} /></label><button className="btn" type="button" onClick={saveShift}>Schedule shift</button></fieldset>}
    {canEdit && <fieldset className="stack" disabled={busy || intent.current !== null} style={{ border: 0, padding: 0, minWidth: 0 }}><legend>Add internal note</legend><textarea value={body} onChange={event => setBody(event.target.value)} maxLength={4000} placeholder="Visible to this workspace team only" /><button className="btn secondary" type="button" onClick={saveNote}>Save internal note</button></fieldset>}
    {intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => { const current = intent.current; if (current) void send(current.path, JSON.parse(current.body), undefined, current.method); }}>Retry same team change</button>}
    {liveNotes.length > 0 && <div className="stack"><h3>Recent notes</h3>{liveNotes.map(item => <article className="card" key={item.id}><p>{item.body}</p><span className="subtle">{new Date(item.createdAt).toLocaleString()}</span></article>)}{noteCursor && <button className="btn secondary" type="button" disabled={reading || busy} onClick={() => void loadOlder('notes')}>Load older notes</button>}</div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
