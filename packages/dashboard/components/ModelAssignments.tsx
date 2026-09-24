'use client';
import { useRef, useState } from 'react';
import { formatDate } from '@axiom/core';
import type { TeamMember } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

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
  const { locale, t } = useLocale();
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
    } catch { setError(t('team.assignmentLoadFailed')); }
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
        if ([400, 422].includes(response.status)) { intent.current = null; setError(t('team.assignmentRejected')); }
        else setError(t('team.assignmentChangeUnconfirmed'));
        return;
      }
      const result = await readDashboardJson<{ data: unknown }>(response);
      if (current.method === 'POST') {
        if (!validAssignment(result.data, modelId) || result.data.userId !== current.userId) throw new Error('unconfirmed grant');
        const grant = result.data;
        setRows(previous => [grant, ...previous.filter(row => row.id !== grant.id)]);
        setUserId(''); setMessage(t('team.assignmentSaved'));
      } else {
        const receipt = result.data as { id?: unknown; revoked?: unknown } | null;
        if (!receipt || receipt.id !== current.assignmentId || receipt.revoked !== true) throw new Error('unconfirmed revoke');
        setRows(previous => previous.filter(row => row.id !== current.assignmentId));
        setMessage(t('team.assignmentRemoved'));
      }
      intent.current = null; setConfirm(null);
    } catch { setError(t('team.assignmentChangeUnconfirmed')); }
    finally { active.current = false; setBusy(false); }
  }

  const locked = busy || !!intent.current;
  const assignmentTime = (value: string) => formatDate(new Date(value), locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  return <section className="card stack" aria-label={t('team.assignmentsAria')}>
    <h3>{t('team.assignmentsTitle')}</h3>
    <p className="subtle">{t('team.assignmentsDescription')}</p>
    <div className="action-row"><button className="btn secondary" type="button" disabled={locked} onClick={() => void load(false)}>{t('team.loadAssignments')}</button></div>
    {loaded && rows.length === 0 && <p>{t('team.noAssignments')}</p>}
    {rows.map(row => <article className="card stack" key={row.id}>
      <strong style={{ overflowWrap: 'anywhere' }}>{label(row.userId)}</strong>
      <span className="subtle">{t('team.assignedAt', { value: assignmentTime(row.createdAt) })}</span>
      {confirm === row.id ? <><p>{t('team.confirmRemoveAssignment', { name: label(row.userId) })}</p><div className="action-row"><button className="btn secondary" type="button" disabled={locked} onClick={() => void save({ path: `${path}/${encodeURIComponent(row.id)}`, method: 'DELETE', userId: row.userId, assignmentId: row.id })}>{t('team.confirmRemoval')}</button><button className="btn secondary" type="button" disabled={locked} onClick={() => setConfirm(null)}>{t('team.keepAssignment')}</button></div></>
        : <button className="btn secondary" type="button" disabled={locked} onClick={() => setConfirm(row.id)}>{t('team.removeAssignment')}</button>}
    </article>)}
    {cursor && <button className="btn secondary" type="button" disabled={locked} onClick={() => void load(true)}>{t('team.loadMoreAssignments')}</button>}
    <fieldset className="stack" disabled={locked || !loaded} style={{ border: 0, padding: 0, minWidth: 0 }}>
      <legend>{t('team.assignMember')}</legend>
      <label>{t('team.teamMember')}<select value={userId} onChange={event => setUserId(event.target.value)}><option value="">{t('team.selectMember')}</option>{members.map(member => <option value={member.id} key={member.id}>{member.email} · {member.role}</option>)}</select></label>
      <button className="btn" type="button" disabled={!userId} onClick={() => { if (members.some(member => member.id === userId)) void save({ path, method: 'POST', userId, body: JSON.stringify({ userId }) }); }}>{t('team.assignToTalent')}</button>
    </fieldset>
    {intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => void save()}>{t('team.retryAssignmentChange')}</button>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </section>;
}
