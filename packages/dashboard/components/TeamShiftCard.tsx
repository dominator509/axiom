'use client';
import { useState } from 'react';
import type { TeamShift } from '@/lib/api';

export default function TeamShiftCard({ shift, assignee, canEdit, disabled, onUpdate }: {
  shift: TeamShift; assignee: string; canEdit: boolean; disabled: boolean;
  onUpdate: (status: string, note?: string) => void;
}) {
  const [handoff, setHandoff] = useState(shift.note ?? '');
  const open = shift.status === 'scheduled' || shift.status === 'active';
  return <article className="card stack">
    <div className="row" style={{ justifyContent: 'space-between' }}><strong>{shift.queue}</strong><span className="badge">{shift.status}</span></div>
    <p className="subtle">{new Date(shift.startsAt).toLocaleString()} → {new Date(shift.endsAt).toLocaleString()} · {assignee}</p>
    {shift.note && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{shift.note}</p>}
    {canEdit && open && <fieldset className="stack" disabled={disabled} style={{ border: 0, padding: 0, minWidth: 0 }}>
      {shift.status === 'active' && <label>Handoff for the next operator<textarea maxLength={2000} value={handoff} onChange={event => setHandoff(event.target.value)} /><span className="subtle">Saved when completing this shift. Closed shifts cannot be reopened or edited.</span></label>}
      <div className="action-row">
        <button className="btn secondary" type="button" onClick={() => onUpdate(shift.status === 'scheduled' ? 'active' : 'completed', shift.status === 'active' ? handoff : undefined)}>{shift.status === 'scheduled' ? 'Start shift' : 'Complete shift and save handoff'}</button>
        <button className="btn secondary" type="button" onClick={() => onUpdate('cancelled')}>Cancel shift</button>
      </div>
    </fieldset>}
  </article>;
}
