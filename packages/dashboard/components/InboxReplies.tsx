'use client';
import { useRef, useState } from 'react';
import { mutationFetch } from '@/lib/mutation';
import { readDashboardJson } from '@/lib/response';
import InboxReplyReviews from './InboxReplyReviews';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const labels = {
  pending: 'Prepared — not sent',
  dispatching: 'Dispatch started — delivery not confirmed',
  sent: 'Accepted by Fanvue — not a read receipt',
  rejected: 'Rejected by Fanvue',
  uncertain: 'Delivery uncertain — do not resend',
  cancelled: 'Cancelled — not sent',
};
interface Reply {
  id: string;
  modelId: string;
  connectionId: string;
  counterpartUuid: string;
  intentKey: string;
  actorUserId: string;
  body: string;
  state: keyof typeof labels;
  createdAt: string;
  remoteMessageUuid: string | null;
  draftSource?: 'human' | 'llm';
  draftActorRef?: string | null;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
}
interface Scope {
  modelId: string;
  connectionId: string;
  counterpartUuid: string;
}
export function isInboxReply(value: unknown, scope: Scope): value is Reply {
  if (!value || typeof value !== 'object') return false;
  const reply = value as Reply;
  return (
    typeof reply.id === 'string' &&
    uuid.test(reply.id) &&
    reply.modelId === scope.modelId &&
    reply.connectionId === scope.connectionId &&
    reply.counterpartUuid === scope.counterpartUuid &&
    typeof reply.intentKey === 'string' &&
    uuid.test(reply.intentKey) &&
    typeof reply.actorUserId === 'string' &&
    reply.actorUserId.length > 0 &&
    typeof reply.body === 'string' &&
    reply.body.trim().length > 0 &&
    reply.body.length <= 5000 &&
    Object.hasOwn(labels, reply.state) &&
    typeof reply.createdAt === 'string' &&
    Number.isFinite(Date.parse(reply.createdAt)) &&
    (reply.state === 'sent'
      ? typeof reply.remoteMessageUuid === 'string' && uuid.test(reply.remoteMessageUuid)
      : reply.remoteMessageUuid === null) &&
    (reply.draftSource === undefined ||
      reply.draftSource === 'human' ||
      reply.draftSource === 'llm') &&
    (reply.draftSource !== 'llm' ||
      (typeof reply.draftActorRef === 'string' && reply.draftActorRef.length > 0)) &&
    (reply.approvedAt === undefined ||
      reply.approvedAt === null ||
      (typeof reply.approvedAt === 'string' && Number.isFinite(Date.parse(reply.approvedAt)))) &&
    (reply.approvedByUserId === undefined ||
      reply.approvedByUserId === null ||
      typeof reply.approvedByUserId === 'string') &&
    (reply.approvedByUserId == null) === (reply.approvedAt == null)
  );
}

export default function InboxReplies({
  modelId,
  connectionId,
  counterpartUuid,
  canPrepare,
  actorUserId,
  canDraft = false,
  llmActorRef,
  conversationKey = 'default',
  canApprove = canPrepare,
}: Scope & {
  canPrepare: boolean;
  actorUserId?: string;
  canDraft?: boolean;
  llmActorRef?: string;
  conversationKey?: string;
  canApprove?: boolean;
}) {
  const [records, setRecords] = useState<Reply[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false);
  const [body, setBody] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [approveId, setApproveId] = useState<string | null>(null);
  const [draftPrompt, setDraftPrompt] = useState('');
  const active = useRef(false);
  const attempted = useRef(new Set<string>());
  const intent = useRef<{ key: string; body: string; request: string } | null>(null);
  const draftIntent = useRef<{ key: string; prompt: string; request: string } | null>(null);
  const scope = { modelId, connectionId, counterpartUuid };
  const path = `/api/v1/models/${encodeURIComponent(modelId)}/inbox/replies`;
  async function load(older: boolean) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError('');
    try {
      const query = new URLSearchParams({
        connectionId,
        counterpartUuid,
        ...(older && cursor ? { cursor } : {}),
      });
      const response = await fetch(`${path}?${query}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('unavailable');
      const result = await readDashboardJson<{ data: unknown[]; meta: { next_cursor: unknown } }>(
        response,
      );
      if (
        !Array.isArray(result.data) ||
        result.data.length > 50 ||
        !result.data.every((reply) => isInboxReply(reply, scope)) ||
        !result.meta ||
        (result.meta.next_cursor !== null &&
          (typeof result.meta.next_cursor !== 'string' || !uuid.test(result.meta.next_cursor)))
      )
        throw new Error('invalid history');
      const replies = result.data as Reply[];
      setRecords((previous) =>
        older
          ? [...previous, ...replies].filter(
              (reply, index, all) => all.findIndex((item) => item.id === reply.id) === index,
            )
          : replies,
      );
      setCursor(result.meta.next_cursor as string | null);
      setLoaded(true);
      setConfirmId(null);
      setCancelId(null);
      setApproveId(null);
      // A fresh server read is required before another explicit send action.
      for (const reply of replies) attempted.current.delete(reply.id);
      // A read can reconcile an uncertain save, but only for the exact outstanding intent.
      const recovered =
        intent.current &&
        replies.find(
          (reply) => reply.intentKey === intent.current!.key && reply.body === intent.current!.body,
        );
      if (recovered) {
        intent.current = null;
        setBody('');
        setMessage('Saved reply found in history. Check its status below.');
      }
    } catch {
      setLoaded(false);
      setError(
        'Reply history could not be verified. Your assignment or shift may have ended. Load history again before preparing another reply.',
      );
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  async function generateDraft() {
    if (
      !canDraft ||
      !llmActorRef ||
      !loaded ||
      active.current ||
      (!draftIntent.current && !draftPrompt.trim())
    )
      return;
    active.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (!draftIntent.current) {
        const key = crypto.randomUUID();
        draftIntent.current = {
          key,
          prompt: draftPrompt.trim(),
          request: JSON.stringify({
            connectionId,
            counterpartUuid,
            intentKey: key,
            conversationKey,
            actor: { type: 'llm', ref: llmActorRef },
            prompt: draftPrompt.trim(),
            confirm: true,
          }),
        };
      }
      const pending = draftIntent.current;
      const response = await mutationFetch(
        `${path}/draft`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: pending.request },
        { idempotencyKey: pending.key, retries: 0 },
      );
      if (!response.ok) throw new Error('unconfirmed');
      const result = await readDashboardJson<{ data: unknown }>(response);
      if (
        !isInboxReply(result.data, scope) ||
        result.data.intentKey !== pending.key ||
        result.data.draftSource !== 'llm'
      )
        throw new Error('invalid draft receipt');
      const saved = result.data;
      setRecords((previous) => [saved, ...previous.filter((reply) => reply.id !== saved.id)]);
      draftIntent.current = null;
      setDraftPrompt('');
      setMessage('Private LLM draft saved for human review. Nothing was sent.');
    } catch {
      setError(
        'Draft generation was not confirmed. Retry the same draft or load history; no message was sent.',
      );
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  async function prepare() {
    if (!canPrepare || !loaded || active.current || (!intent.current && !body.trim())) return;
    active.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (!intent.current) {
        const key = crypto.randomUUID();
        intent.current = {
          key,
          body,
          request: JSON.stringify({ connectionId, counterpartUuid, intentKey: key, body }),
        };
      }
      const pending = intent.current;
      const response = await mutationFetch(
        path,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: pending.request },
        { idempotencyKey: pending.key, retries: 0 },
      );
      if (!response.ok) throw new Error('unconfirmed');
      const result = await readDashboardJson<{ data: unknown }>(response);
      if (
        !isInboxReply(result.data, scope) ||
        result.data.intentKey !== pending.key ||
        result.data.body !== pending.body
      )
        throw new Error('invalid receipt');
      const saved = result.data;
      setRecords((previous) => [saved, ...previous.filter((reply) => reply.id !== saved.id)]);
      intent.current = null;
      setBody('');
      setMessage('Reply saved. Check its status below; saving does not send a message.');
    } catch {
      setError(
        'Save not confirmed. Load history or retry this same reply. Do not start a duplicate.',
      );
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  async function sendReply(reply: Reply) {
    const canAct = Boolean(
      actorUserId &&
      (reply.actorUserId === actorUserId ||
        (reply.draftSource === 'llm' && reply.approvedByUserId === actorUserId)),
    );
    if (
      !canPrepare ||
      !canAct ||
      (reply.draftSource === 'llm' && !reply.approvedByUserId) ||
      reply.state !== 'pending' ||
      confirmId !== reply.id ||
      !loaded ||
      active.current ||
      attempted.current.has(reply.id)
    )
      return;
    active.current = true;
    attempted.current.add(reply.id);
    setBusy(true);
    setConfirmId(null);
    setError('');
    setMessage('');
    try {
      const response = await mutationFetch(
        `${path}/${encodeURIComponent(reply.id)}/send`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ confirm: true }),
        },
        { idempotencyKey: crypto.randomUUID(), retries: 0 },
      );
      if (!response.ok) throw new Error('unconfirmed');
      const result = await readDashboardJson<{ data: { replyId: string; state: string } }>(
        response,
      );
      if (
        result.data?.replyId !== reply.id ||
        !['sent', 'rejected', 'uncertain'].includes(result.data?.state)
      )
        throw new Error('invalid status');
      setMessage(
        result.data.state === 'sent'
          ? 'Fanvue accepted the reply. Load history for its receipt; this is not a read receipt.'
          : result.data.state === 'rejected'
            ? 'Fanvue rejected the reply. Load history; nothing will retry automatically.'
            : 'Delivery is uncertain. Do not resend or create a duplicate. Load history and reconcile with Fanvue.',
      );
    } catch {
      setError(
        'Delivery not confirmed. Do not resend or create a duplicate. Load reply history to check status and access.',
      );
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  async function approveDraft(reply: Reply) {
    if (
      !canApprove ||
      reply.draftSource !== 'llm' ||
      reply.state !== 'pending' ||
      reply.approvedByUserId ||
      approveId !== reply.id ||
      !loaded ||
      active.current ||
      attempted.current.has(reply.id)
    )
      return;
    active.current = true;
    attempted.current.add(reply.id);
    setBusy(true);
    setApproveId(null);
    setError('');
    setMessage('');
    try {
      const response = await mutationFetch(
        `${path}/${encodeURIComponent(reply.id)}/approve`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ confirm: true }),
        },
        { idempotencyKey: reply.intentKey, retries: 0 },
      );
      if (!response.ok) throw new Error('unconfirmed');
      const result = await readDashboardJson<{ data: unknown }>(response);
      const approved = result.data;
      if (
        !isInboxReply(approved, scope) ||
        approved.id !== reply.id ||
        !approved.approvedByUserId
      )
        throw new Error('invalid approval receipt');
      setRecords((previous) => previous.map((item) => (item.id === reply.id ? approved : item)));
      attempted.current.delete(reply.id);
      setMessage(
        'Draft approved by a human. Sending still requires the separate confirmation below.',
      );
    } catch {
      setError('Approval was not confirmed. Load reply history before taking further action.');
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  async function cancelPrepared(reply: Reply) {
    if (
      !canPrepare ||
      !actorUserId ||
      reply.actorUserId !== actorUserId ||
      reply.state !== 'pending' ||
      cancelId !== reply.id ||
      !loaded ||
      active.current ||
      attempted.current.has(reply.id)
    )
      return;
    active.current = true;
    attempted.current.add(reply.id);
    setBusy(true);
    setCancelId(null);
    setError('');
    setMessage('');
    try {
      const response = await mutationFetch(
        `${path}/${encodeURIComponent(reply.id)}/cancel`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ confirm: true }),
        },
        { idempotencyKey: crypto.randomUUID(), retries: 0 },
      );
      if (!response.ok) throw new Error('unconfirmed');
      const result = await readDashboardJson<{ data: { replyId: string; state: string } }>(
        response,
      );
      if (result.data?.replyId !== reply.id || result.data.state !== 'cancelled')
        throw new Error('invalid cancellation');
      setRecords((previous) =>
        previous.map((item) => (item.id === reply.id ? { ...item, state: 'cancelled' } : item)),
      );
      attempted.current.delete(reply.id);
      setMessage(
        'Prepared reply cancelled. Nothing was sent. You can prepare corrected text as a new reply.',
      );
    } catch {
      setError(
        'Cancellation not confirmed. Load reply history before taking further action; cancellation cannot recall a message already being sent.',
      );
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="card stack" aria-label="Workspace replies">
      <h3>Workspace replies</h3>
      <p>
        Prepare a text reply for this conversation and review saved attempts. Sending requires a
        separate confirmation. Attachment previews are not available here yet. Nothing is sent when
        you save.
      </p>
      <p className="subtle">
        Load history before preparing a reply, including after a page reload. Unsaved text stays
        only in this page and is lost when you leave.
      </p>
      <div className="action-row">
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={() => void load(false)}
        >
          Load reply history
        </button>
        {cursor && (
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => void load(true)}
          >
            Load older replies
          </button>
        )}
      </div>
      {loaded && records.length === 0 && <p>No saved replies in this conversation.</p>}
      {canDraft && llmActorRef && (
        <section className="card stack" aria-label="Assigned LLM draft">
          <h3>Assigned LLM draft</h3>
          <p className="subtle">
            Generate one bounded private reply using the assigned actor’s handoff, persona and
            memory. The result is saved for human review only; it is never sent automatically.
          </p>
          <label className="stack">
            Draft instruction
            <textarea
              value={draftPrompt}
              maxLength={4000}
              rows={4}
              disabled={busy || !!draftIntent.current}
              onChange={(event) => setDraftPrompt(event.target.value)}
            />
          </label>
          <p className="subtle">
            Actor: {llmActorRef} · {draftPrompt.length}/4000 characters
          </p>
          <div className="action-row">
            <button
              className="btn secondary"
              type="button"
              disabled={busy || !loaded || (!draftIntent.current && !draftPrompt.trim())}
              onClick={() => void generateDraft()}
            >
              {draftIntent.current ? 'Retry same private draft' : 'Generate private LLM draft'}
            </button>
          </div>
        </section>
      )}
      {records.map((reply) => (
        <article key={reply.id} className="card stack">
          <h4>
            {attempted.current.has(reply.id)
              ? 'Action attempted — refresh status'
              : reply.draftSource === 'llm'
                ? `LLM draft · ${labels[reply.state]}`
                : labels[reply.state]}
          </h4>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{reply.body}</p>
          {reply.draftSource === 'llm' && (
            <p className="subtle">
              Proposed by {reply.draftActorRef}.{' '}
              {reply.approvedByUserId
                ? `Human approval recorded by ${reply.approvedByUserId}.`
                : 'Human approval required before sending.'}
            </p>
          )}
          <p className="subtle">
            {new Date(reply.createdAt).toLocaleString()} · Prepared by {reply.actorUserId}
          </p>
          {reply.remoteMessageUuid && (
            <p className="subtle">Provider receipt: {reply.remoteMessageUuid}</p>
          )}
          {['dispatching', 'uncertain', 'sent', 'rejected'].includes(reply.state) && (
            <InboxReplyReviews
              modelId={modelId}
              replyId={reply.id}
              canReview={canPrepare && ['dispatching', 'uncertain'].includes(reply.state)}
            />
          )}
          {canApprove &&
            reply.draftSource === 'llm' &&
            reply.state === 'pending' &&
            !reply.approvedByUserId && (
              <div className="stack">
                {approveId === reply.id ? (
                  <>
                    <p>
                      Approve this exact generated text for a human-controlled send review? Approval
                      does not send it.
                    </p>
                    <div className="action-row">
                      <button
                        type="button"
                        className="btn"
                        disabled={busy || !loaded}
                        onClick={() => void approveDraft(reply)}
                      >
                        Confirm human approval
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busy}
                        onClick={() => setApproveId(null)}
                      >
                        Keep pending
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={busy || !loaded}
                    onClick={() => {
                      setApproveId(reply.id);
                      setConfirmId(null);
                      setCancelId(null);
                    }}
                  >
                    Review and approve draft
                  </button>
                )}
              </div>
            )}
          {canPrepare &&
            actorUserId &&
            (actorUserId === reply.actorUserId ||
              (reply.draftSource === 'llm' && reply.approvedByUserId === actorUserId)) &&
            reply.state === 'pending' &&
            (reply.draftSource !== 'llm' || Boolean(reply.approvedByUserId)) && (
              <div className="stack">
                {attempted.current.has(reply.id) ? (
                  <p>An action was attempted. Load history before taking further action.</p>
                ) : confirmId === reply.id ? (
                  <>
                    <p>
                      This sends the exact text above to this Fanvue conversation immediately. It
                      cannot be recalled here.
                    </p>
                    <div className="action-row">
                      <button
                        type="button"
                        className="btn"
                        disabled={busy || !loaded}
                        onClick={() => void sendReply(reply)}
                      >
                        Confirm send to Fanvue
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busy}
                        onClick={() => setConfirmId(null)}
                      >
                        Keep prepared
                      </button>
                    </div>
                  </>
                ) : cancelId === reply.id ? (
                  <>
                    <p>
                      Cancel this prepared reply? Its text stays in history, but it will not be
                      sent.
                    </p>
                    <div className="action-row">
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busy || !loaded}
                        onClick={() => void cancelPrepared(reply)}
                      >
                        Confirm cancellation
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busy}
                        onClick={() => setCancelId(null)}
                      >
                        Keep prepared
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="action-row">
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={busy || !loaded}
                      onClick={() => {
                        setCancelId(null);
                        setConfirmId(reply.id);
                      }}
                    >
                      Send prepared reply
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={busy || !loaded}
                      onClick={() => {
                        setConfirmId(null);
                        setCancelId(reply.id);
                      }}
                    >
                      Cancel prepared reply
                    </button>
                  </div>
                )}
              </div>
            )}
        </article>
      ))}
      {canPrepare && (
        <>
          <label className="stack">
            Reply text
            <textarea
              value={body}
              maxLength={5000}
              rows={5}
              disabled={!loaded || busy || !!intent.current}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <p className="subtle">{body.length}/5000 characters. Saved text cannot be edited.</p>
          <div className="action-row">
            <button
              className="btn"
              type="button"
              disabled={!loaded || busy || (!intent.current && !body.trim())}
              onClick={() => void prepare()}
            >
              {intent.current ? 'Retry saving same reply' : 'Save reply without sending'}
            </button>
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
