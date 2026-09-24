'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TeamAgentPermission, TeamMember, TeamNote, TeamShift } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import TeamShiftCard from './TeamShiftCard';
import { useLocale } from './LocaleProvider';

export default function TeamOperationsManager({ modelId, members, shifts, shiftsMeta, notes, notesMeta, agentPermissions, canEdit }: { modelId: string; members: TeamMember[]; shifts: TeamShift[]; shiftsMeta?: { next_cursor: string | null }; notes: TeamNote[]; notesMeta?: { next_cursor: string | null }; agentPermissions: TeamAgentPermission[]; canEdit: boolean }) {
  const router = useRouter();
  const { locale, t } = useLocale();
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const roleKey = (role: string): string => ({
    owner: 'role.owner', manager: 'role.manager', operator: 'role.operator', analyst: 'role.analyst',
    agent: 'role.agent', chatter: 'role.chatter', content_creator: 'role.contentCreator', model: 'role.model', member: 'role.member',
  }[role] ?? role);
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
    } catch { setError(t(kind === 'shifts' ? 'team.olderShiftsLoadFailed' : 'team.olderNotesLoadFailed')); }
    finally { setReading(false); }
  }

  async function send(path: string, nextBody: Record<string, unknown>, success?: () => void, method: 'POST' | 'PATCH' = 'POST') {
    if (!canEdit || busy) return;
    intent.current ??= { path, body: JSON.stringify(nextBody), key: createIdempotencyKey(), method };
    setBusy(true); setError('');
    try {
      const response = await mutationFetch(intent.current.path, { method: intent.current.method, headers: { 'content-type': 'application/json' }, body: intent.current.body }, { idempotencyKey: intent.current.key, retries: 0 });
      if (!response.ok) { const details = await readDashboardError(response); setError(details?.error?.message ?? t('team.teamChangeNotAccepted')); if ([400, 401, 403, 404, 409, 422].includes(response.status)) intent.current = null; return; }
      const result = await readDashboardJson<{ data?: unknown }>(response); if (!result.data) throw new Error('unconfirmed team response');
      intent.current = null; success?.(); router.refresh();
    } catch { setError(t('team.teamChangeNotConfirmed')); }
    finally { setBusy(false); }
  }

  function saveShift() {
    if ((!assigneeUserId && assigneeType === 'human') || (!assigneeAgentRef && assigneeType === 'llm') || !startsAt || !endsAt) { setError(t('team.chooseActorTimes')); return; }
  void send(`/api/v1/models/${encodeURIComponent(modelId)}/team-shifts`, { assigneeType, ...(assigneeType === 'human' ? { assigneeUserId } : { assigneeAgentRef }), queue, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), note });
  }
  function saveNote() { if (!body.trim()) { setError(t('team.enterNote')); return; } void send(`/api/v1/models/${encodeURIComponent(modelId)}/team-notes`, { body: body.trim() }, () => setBody('')); }
  function updateShift(shift: TeamShift, status: string, note?: string) { void send(`/api/v1/models/${encodeURIComponent(modelId)}/team-shifts/${encodeURIComponent(shift.id)}`, { status, ...(note === undefined ? {} : { note }) }, undefined, 'PATCH'); }

  return <div className="stack">
    <p className="subtle">{t('team.operationsDescription')}</p>
    {liveShifts.length > 0 && <div className="stack">{liveShifts.map(shift => <TeamShiftCard key={`${shift.id}:${shift.status}:${shift.note}`} shift={shift} assignee={shift.assigneeType === 'llm' ? t('team.llmActor', { ref: shift.assigneeAgentRef ?? '' }) : t('team.humanActor', { ref: members.find(member => member.id === shift.assigneeUserId)?.email ?? shift.assigneeUserId ?? t('team.unknownActor') })} canEdit={canEdit} disabled={busy || !!intent.current} onUpdate={(status, note) => updateShift(shift, status, note)} />)}</div>}
    {shiftCursor && <button className="btn secondary" type="button" disabled={reading || busy} onClick={() => void loadOlder('shifts')}>{t('team.loadOlderShifts')}</button>}
    {canEdit && <fieldset className="stack" disabled={busy || intent.current !== null} style={{ border: 0, padding: 0, minWidth: 0 }}><legend>{t('team.scheduleShift')}</legend><div className="row"><label>{t('team.actorType')}<select value={assigneeType} onChange={event => setAssigneeType(event.target.value as 'human' | 'llm')}><option value="human">{t('team.humanChatter')}</option><option value="llm" disabled={!agentPermissions.some(permission => permission.canEdit)}>{t('team.assignedLlm')}</option></select></label>{assigneeType === 'human' ? <label>{t('team.teamMember')}<select value={assigneeUserId} onChange={event => setAssigneeUserId(event.target.value)}>{members.map(member => <option key={member.id} value={member.id}>{member.email} · {t(roleKey(member.role))}</option>)}</select></label> : <label>{t('team.llmPermission')}<select value={assigneeAgentRef} onChange={event => setAssigneeAgentRef(event.target.value)}><option value="">{t('team.selectEditableActor')}</option>{agentPermissions.filter(permission => permission.canEdit).map(permission => <option key={permission.id} value={permission.agentRef}>{permission.agentRef} · {permission.tier}</option>)}</select></label>}<label>{t('team.queue')}<input value={queue} onChange={event => setQueue(event.target.value)} maxLength={100} /></label></div><div className="row"><label>{t('team.starts')}<input type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label><label>{t('team.ends')}<input type="datetime-local" value={endsAt} onChange={event => setEndsAt(event.target.value)} /></label></div><label>{t('team.shiftNote')}<input value={note} onChange={event => setNote(event.target.value)} maxLength={2000} /></label><button className="btn" type="button" onClick={saveShift}>{t('team.scheduleShift')}</button></fieldset>}
    {canEdit && <fieldset className="stack" disabled={busy || intent.current !== null} style={{ border: 0, padding: 0, minWidth: 0 }}><legend>{t('team.addInternalNote')}</legend><textarea value={body} onChange={event => setBody(event.target.value)} maxLength={4000} placeholder={t('team.internalNotePlaceholder')} /><button className="btn secondary" type="button" onClick={saveNote}>{t('team.saveInternalNote')}</button></fieldset>}
    {intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => { const current = intent.current; if (current) void send(current.path, JSON.parse(current.body), undefined, current.method); }}>{t('team.retrySameChange')}</button>}
    {liveNotes.length > 0 && <div className="stack"><h3>{t('team.recentNotes')}</h3>{liveNotes.map(item => <article className="card" key={item.id}><p>{item.body}</p><span className="subtle">{dateTime.format(new Date(item.createdAt))}</span></article>)}{noteCursor && <button className="btn secondary" type="button" disabled={reading || busy} onClick={() => void loadOlder('notes')}>{t('team.loadOlderNotes')}</button>}</div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
