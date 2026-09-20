'use client';
import { useRef, useState } from 'react';
import { formatDate } from '@axiom/core';
import type { TeamNote } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

export function isPostNote(value: unknown, modelId: string, postId: string): value is TeamNote {
  if (!value || typeof value !== 'object') return false;
  const note = value as TeamNote;
  return typeof note.id === 'string' && note.modelId === modelId && note.targetType === 'post' && note.targetId === postId
    && typeof note.body === 'string' && typeof note.authorUserId === 'string' && Number.isFinite(Date.parse(note.createdAt));
}
export default function PostTeamNotes({ modelId, postId, canEdit }: { modelId: string; postId: string; canEdit: boolean }) {
  const { locale, t } = useLocale();
  const [notes, setNotes] = useState<TeamNote[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [body, setBody] = useState(''), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const active = useRef(false);
  const intent = useRef<{ key: string; body: string } | null>(null);
  const path = `/api/v1/models/${encodeURIComponent(modelId)}/team-notes`;
  async function load(older: boolean) {
    if (active.current) return;
    active.current = true; setBusy(true); setError('');
    try {
      const query = new URLSearchParams({ postId, ...(older && cursor ? { cursor } : {}) });
      const response = await fetch(`${path}?${query}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('unavailable');
      const result = await readDashboardJson<{ data: unknown[]; meta: { next_cursor: string | null } }>(response);
      if (!Array.isArray(result.data) || result.data.length > 50 || !result.data.every(note => isPostNote(note, modelId, postId))
        || !result.meta || (result.meta.next_cursor !== null && !/^[0-9a-f-]{36}$/i.test(result.meta.next_cursor))) throw new Error('invalid notes');
      setNotes(previous => older ? [...previous, ...result.data as TeamNote[]].filter((note, index, all) => all.findIndex(item => item.id === note.id) === index) : result.data as TeamNote[]);
      setCursor(result.meta.next_cursor); setLoaded(true);
    } catch { setError(t('team.postNotesLoadFailed')); }
    finally { active.current = false; setBusy(false); }
  }
  async function save() {
    if (!canEdit || active.current || (!intent.current && !body.trim())) return;
    intent.current ??= { key: createIdempotencyKey(), body: JSON.stringify({ targetType: 'post', targetId: postId, body: body.trim() }) };
    active.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const response = await mutationFetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: intent.current.body }, { idempotencyKey: intent.current.key, retries: 0 });
      if (!response.ok) {
        const failure = await readDashboardError(response);
        if ([400, 422].includes(response.status)) intent.current = null;
        setError(failure?.error?.message ?? t('team.postNoteSaveUnconfirmed')); return;
      }
      const result = await readDashboardJson<{ data: unknown }>(response);
      if (!isPostNote(result.data, modelId, postId) || result.data.body !== JSON.parse(intent.current.body).body) throw new Error('unconfirmed note');
      const saved = result.data;
      setNotes(previous => [saved, ...previous.filter(note => note.id !== saved.id)]);
      setBody(''); intent.current = null; setMessage(t('team.postNoteSaved'));
    } catch { setError(t('team.postNoteSaveUnconfirmed')); }
    finally { active.current = false; setBusy(false); }
  }
  const noteTime = (value: string) => formatDate(new Date(value), locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  return <details><summary>{t('team.postNotesSummary')}</summary><div className="stack">
    <p className="subtle">{t('team.postNotesDescription')}</p>
    <button type="button" className="btn secondary" disabled={busy} onClick={() => void load(false)}>{t('team.loadLatestPostNotes')}</button>
    {loaded && notes.length === 0 && <p>{t('team.noPostNotes')}</p>}
    {notes.map(note => <article key={note.id} className="card"><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{note.body}</p><span className="subtle">{noteTime(note.createdAt)} · {note.authorUserId}</span></article>)}
    {cursor && <button type="button" className="btn secondary" disabled={busy} onClick={() => void load(true)}>{t('team.loadOlderPostNotes')}</button>}
    {canEdit && <><label>{t('team.newPostNote')}<textarea value={body} onChange={event => setBody(event.target.value)} maxLength={4000} disabled={busy || !!intent.current} /></label><button type="button" className="btn secondary" disabled={busy || (!intent.current && !body.trim())} onClick={() => void save()}>{intent.current ? t('team.retryPostNote') : t('team.savePostNote')}</button></>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </div></details>;
}
