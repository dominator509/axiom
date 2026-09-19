'use client';
import { useRef, useState } from 'react';
import * as React from 'react';
import { CATALOGS, LocaleCatalog, intlLocale, type SupportedLocale } from '@axiom/core';
import { mutationFetch } from '@/lib/mutation';
import { readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

const fallbackCatalog = new LocaleCatalog(CATALOGS);
const englishT = (key: string, values?: Record<string, string | number>) => fallbackCatalog.t('en', key, values);

/**
 * Unit tests invoke this component directly (without a React renderer). React
 * has no dispatcher in that case, so calling a hook would warn and throw.
 * Detect an active renderer and only bind the provider locale inside one.
 */
function hasReactDispatcher(): boolean {
  const internals = (React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: { H?: unknown };
  }).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  return Boolean(internals && internals.H);
}

function useInboxStrings(): { t: (key: string, values?: Record<string, string | number>) => string; locale: SupportedLocale } {
  const provider = hasReactDispatcher() ? useLocale() : undefined;
  return { t: provider?.t ?? englishT, locale: provider?.locale ?? 'en' };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface Review {
  id: string; modelId: string; replyId: string; actorUserId: string; intentKey: string;
  conclusion: 'observed_sent' | 'unresolved'; observedMessageUuid: string | null;
  note: string; evidenceSource: 'operator_review'; createdAt: string;
}
export function isReplyReview(value: unknown, modelId: string, replyId: string): value is Review {
  if (!value || typeof value !== 'object') return false;
  const review = value as Review;
  return typeof review.id === 'string' && uuid.test(review.id) && review.modelId === modelId && review.replyId === replyId
    && typeof review.actorUserId === 'string' && review.actorUserId.length > 0
    && typeof review.intentKey === 'string' && uuid.test(review.intentKey) && review.evidenceSource === 'operator_review'
    && typeof review.note === 'string' && review.note.trim().length > 0 && review.note.length <= 2000
    && typeof review.createdAt === 'string' && Number.isFinite(Date.parse(review.createdAt))
    && (review.conclusion === 'observed_sent' ? typeof review.observedMessageUuid === 'string' && uuid.test(review.observedMessageUuid)
      : review.conclusion === 'unresolved' && review.observedMessageUuid === null);
}
export default function InboxReplyReviews({ modelId, replyId, canReview }: { modelId: string; replyId: string; canReview: boolean }) {
  const { t, locale } = useInboxStrings();
  const [reviews, setReviews] = useState<Review[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false);
  const [conclusion, setConclusion] = useState('unresolved'), [observed, setObserved] = useState(''), [note, setNote] = useState('');
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const active = useRef(false), intent = useRef<{ key: string; payload: string } | null>(null);
  const path = `/api/v1/models/${encodeURIComponent(modelId)}/inbox/replies/${encodeURIComponent(replyId)}/reviews`;
  const matchesIntent = (review: Review) => {
    if (!intent.current || review.intentKey !== intent.current.key) return false;
    const expected = JSON.parse(intent.current.payload);
    return review.note === expected.note && review.conclusion === expected.conclusion && review.observedMessageUuid === expected.observedMessageUuid;
  };
  // Reviews are records, not UI text: format the timestamp with the selected
  // locale and explicit UTC rather than the host locale.
  const formatReviewTime = (value: string) => new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
  }).format(new Date(value));
  function clearSaved() { intent.current = null; setNote(''); setObserved(''); setConclusion('unresolved'); setMessage(t('inbox.reviews.recorded')); }
  async function load(older: boolean) {
    if (active.current) return;
    active.current = true; setBusy(true); setError('');
    try {
      const query = older && cursor ? `?${new URLSearchParams({ cursor })}` : '';
      const response = await fetch(`${path}${query}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('unavailable');
      const result = await readDashboardJson<{ data: unknown[]; meta: { next_cursor: unknown } }>(response);
      if (!Array.isArray(result.data) || result.data.length > 50 || !result.data.every(row => isReplyReview(row, modelId, replyId))
        || !result.meta || (result.meta.next_cursor !== null && (typeof result.meta.next_cursor !== 'string' || !uuid.test(result.meta.next_cursor)))) throw new Error('invalid history');
      const rows = result.data as Review[];
      setReviews(previous => older ? [...previous, ...rows].filter((row, index, all) => all.findIndex(item => item.id === row.id) === index) : rows);
      setCursor(result.meta.next_cursor as string | null); setLoaded(true);
      if (rows.some(matchesIntent)) clearSaved();
    } catch { setLoaded(false); setError(t('inbox.reviews.historyLoadFailed')); }
    finally { active.current = false; setBusy(false); }
  }
  async function save() {
    if (!canReview || !loaded || active.current || (!intent.current && (!note.trim() || (conclusion === 'observed_sent' && !uuid.test(observed))))) return;
    active.current = true; setBusy(true); setError(''); setMessage('');
    try {
      if (!intent.current) {
        const key = crypto.randomUUID();
        intent.current = { key, payload: JSON.stringify({ intentKey: key, conclusion, observedMessageUuid: conclusion === 'observed_sent' ? observed.toLowerCase() : null, note }) };
      }
      const response = await mutationFetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: intent.current.payload }, { idempotencyKey: intent.current.key, retries: 0 });
      if (!response.ok) throw new Error('unconfirmed');
      const result = await readDashboardJson<{ data: unknown }>(response);
      if (!isReplyReview(result.data, modelId, replyId) || !matchesIntent(result.data)) throw new Error('invalid receipt');
      const saved = result.data;
      setReviews(previous => [saved, ...previous.filter(row => row.id !== saved.id)]); clearSaved();
    } catch { setError(t('inbox.reviews.saveNotConfirmed')); }
    finally { active.current = false; setBusy(false); }
  }
  return <details><summary>{t('inbox.reviews.summary')}</summary><div className="stack">
    <p>{t('inbox.reviews.disclaimer')}</p>
    <div className="action-row"><button type="button" className="btn secondary" disabled={busy} onClick={() => void load(false)}>{t('inbox.reviews.load')}</button>
      {cursor && <button type="button" className="btn secondary" disabled={busy} onClick={() => void load(true)}>{t('inbox.reviews.loadOlder')}</button>}</div>
    {loaded && reviews.length === 0 && <p>{t('inbox.reviews.empty')}</p>}
    {reviews.map(review => <article key={review.id} className="card stack">
      <h4>{review.conclusion === 'observed_sent' ? t('inbox.reviews.reportedSent') : t('inbox.reviews.unresolved')}</h4>
      {review.observedMessageUuid && <p>{t('inbox.reviews.operatorMessageId', { id: review.observedMessageUuid })}</p>}
      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{review.note}</p>
      <p className="subtle">{formatReviewTime(review.createdAt)} · {review.actorUserId}</p>
    </article>)}
    {canReview && <><fieldset className="stack" disabled={!loaded || busy || !!intent.current}>
      <legend>{t('inbox.reviews.legend')}</legend>
      <label className="stack">{t('inbox.reviews.conclusionLabel')}<select value={conclusion} onChange={event => setConclusion(event.target.value)}><option value="unresolved">{t('inbox.reviews.stillUnresolved')}</option><option value="observed_sent">{t('inbox.reviews.observedSent')}</option></select></label>
      {conclusion === 'observed_sent' && <label className="stack">{t('inbox.reviews.providerUuidLabel')}<input value={observed} onChange={event => setObserved(event.target.value)} maxLength={36} spellCheck={false} /></label>}
      <label className="stack">{t('inbox.reviews.noteLabel')}<textarea value={note} onChange={event => setNote(event.target.value)} maxLength={2000} rows={4} /></label>
      <p className="subtle">{t('inbox.reviews.guidance')}</p>
    </fieldset><div className="action-row"><button type="button" className="btn secondary" disabled={!loaded || busy || (!intent.current && (!note.trim() || (conclusion === 'observed_sent' && !uuid.test(observed))))} onClick={() => void save()}>{intent.current ? t('inbox.reviews.retry') : t('inbox.reviews.record')}</button></div></>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </div></details>;
}
