'use client';
import { useState } from 'react';
import type { TeamShift } from '@/lib/api';
import { useLocale } from './LocaleProvider';

export default function TeamShiftCard({ shift, assignee, canEdit, disabled, onUpdate }: {
  shift: TeamShift; assignee: string; canEdit: boolean; disabled: boolean;
  onUpdate: (status: string, note?: string) => void;
}) {
  const [handoff, setHandoff] = useState(shift.note ?? '');
  const { locale, t } = useLocale();
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const open = shift.status === 'scheduled' || shift.status === 'active';
  return <article className="card stack">
    <div className="row" style={{ justifyContent: 'space-between' }}><strong>{shift.queue}</strong><span className="badge">{shift.status}</span></div>
    <p className="subtle">{t('team.shiftTime', { start: dateTime.format(new Date(shift.startsAt)), end: dateTime.format(new Date(shift.endsAt)), assignee })}</p>
    {shift.note && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{shift.note}</p>}
    {canEdit && open && <fieldset className="stack" disabled={disabled} style={{ border: 0, padding: 0, minWidth: 0 }}>
      {shift.status === 'active' && <label>{t('team.handoffForNextOperator')}<textarea maxLength={2000} value={handoff} onChange={event => setHandoff(event.target.value)} /><span className="subtle">{t('team.handoffSaveHint')} {t('team.closedCannotEdit')}</span></label>}
      <div className="action-row">
        <button className="btn secondary" type="button" onClick={() => onUpdate(shift.status === 'scheduled' ? 'active' : 'completed', shift.status === 'active' ? handoff : undefined)}>{shift.status === 'scheduled' ? t('team.startShift') : t('team.completeShift')}</button>
        <button className="btn secondary" type="button" onClick={() => onUpdate('cancelled')}>{t('team.cancelShift')}</button>
      </div>
    </fieldset>}
  </article>;
}
