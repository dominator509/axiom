'use client';
import { useRef, useState } from 'react';
import { mutationFetch } from '@/lib/mutation';
import { readDashboardJson } from '@/lib/response';

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
  function clearSaved() { intent.current = null; setNote(''); setObserved(''); setConclusion('unresolved'); setMessage('Operator review recorded. Original delivery state is unchanged; no message was sent.'); }
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
    } catch { setLoaded(false); setError('Review history could not be verified. Reload history to check your access; this does not mean there are no reviews.'); }
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
    } catch { setError('Review save not confirmed. Reload history or retry the same review; do not submit a duplicate.'); }
    finally { active.current = false; setBusy(false); }
  }
  return <details><summary>Delivery review evidence</summary><div className="stack">
    <p>These are operator observations, not automatically verified provider receipts. They do not change the original delivery result or authorize another send. Absence from a message page does not prove non-delivery.</p>
    <div className="action-row"><button type="button" className="btn secondary" disabled={busy} onClick={() => void load(false)}>Load delivery reviews</button>
      {cursor && <button type="button" className="btn secondary" disabled={busy} onClick={() => void load(true)}>Load older reviews</button>}</div>
    {loaded && reviews.length === 0 && <p>No recorded delivery reviews.</p>}
    {reviews.map(review => <article key={review.id} className="card stack">
      <h4>{review.conclusion === 'observed_sent' ? 'Operator reports a sent message' : 'Operator could not resolve delivery'}</h4>
      {review.observedMessageUuid && <p>Operator-supplied message ID: {review.observedMessageUuid}</p>}
      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{review.note}</p>
      <p className="subtle">{new Date(review.createdAt).toLocaleString()} · {review.actorUserId}</p>
    </article>)}
    {canReview && <><fieldset className="stack" disabled={!loaded || busy || !!intent.current}>
      <legend>Record your external review</legend>
      <label className="stack">Review conclusion<select value={conclusion} onChange={event => setConclusion(event.target.value)}><option value="unresolved">Still unresolved</option><option value="observed_sent">I observed the sent message</option></select></label>
      {conclusion === 'observed_sent' && <label className="stack">Provider message UUID<input value={observed} onChange={event => setObserved(event.target.value)} maxLength={36} spellCheck={false} /></label>}
      <label className="stack">Evidence and context<textarea value={note} onChange={event => setNote(event.target.value)} maxLength={2000} rows={4} /></label>
      <p className="subtle">Record how you checked this exact account and conversation. Do not paste credentials or unrelated private messages. Reviews cannot be edited; add a follow-up to correct one.</p>
    </fieldset><div className="action-row"><button type="button" className="btn secondary" disabled={!loaded || busy || (!intent.current && (!note.trim() || (conclusion === 'observed_sent' && !uuid.test(observed))))} onClick={() => void save()}>{intent.current ? 'Retry saving same review' : 'Record operator review'}</button></div></>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </div></details>;
}
