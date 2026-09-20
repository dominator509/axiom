'use client';
import * as React from 'react';
import { useRef, useState } from 'react';
import { CATALOGS, formatDate, LocaleCatalog, type SupportedLocale } from '@axiom/core';
import { mutationFetch } from '@/lib/mutation';
import { readDashboardJson } from '@/lib/response';
import InboxReplyReviews from './InboxReplyReviews';
import { useLocale } from './LocaleProvider';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fallbackCatalog = new LocaleCatalog(CATALOGS);
const englishT = (key: string, values?: Record<string, string | number>) => fallbackCatalog.t('en', key, values);
const stateKeys = {
  pending: 'inbox.replies.state.pending',
  dispatching: 'inbox.replies.state.dispatching',
  sent: 'inbox.replies.state.sent',
  rejected: 'inbox.replies.state.rejected',
  uncertain: 'inbox.replies.state.uncertain',
  cancelled: 'inbox.replies.state.cancelled',
} as const;

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
interface Reply {
  id: string;
  modelId: string;
  connectionId: string;
  counterpartUuid: string;
  intentKey: string;
  actorUserId: string;
  body: string;
  state: keyof typeof stateKeys;
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
    Object.hasOwn(stateKeys, reply.state) &&
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
  const { t, locale } = useInboxStrings();
  const path = `/api/v1/models/${encodeURIComponent(modelId)}/inbox/replies`;
  const replyTime = (value: string) => formatDate(new Date(value), locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
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
        setMessage(t('inbox.replies.savedFound'));
      }
    } catch {
      setLoaded(false);
      setError(t('inbox.replies.historyLoadFailed'));
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
      setMessage(t('inbox.replies.draftSaved'));
    } catch {
      setError(t('inbox.replies.draftFailed'));
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
      setMessage(t('inbox.replies.saved'));
    } catch {
      setError(t('inbox.replies.saveFailed'));
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
          ? t('inbox.replies.sendAccepted')
          : result.data.state === 'rejected'
            ? t('inbox.replies.sendRejected')
            : t('inbox.replies.sendUncertain'),
      );
    } catch {
      setError(t('inbox.replies.sendFailed'));
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
      setMessage(t('inbox.replies.humanApprovalRecorded', { actor: approved.approvedByUserId }));
    } catch {
      setError(t('inbox.replies.approvalFailed'));
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
      setMessage(t('inbox.replies.cancellationSaved'));
    } catch {
      setError(t('inbox.replies.cancellationFailed'));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="card stack" aria-label={t('inbox.replies.title')}>
      <h3>{t('inbox.replies.title')}</h3>
      <p>
        {t('inbox.replies.description')} {t('inbox.replies.attachmentUnavailable')}
      </p>
      <p className="subtle">
        {t('inbox.replies.loadBeforePreparing')}
      </p>
      <div className="action-row">
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={() => void load(false)}
        >
          {t('inbox.replies.load')}
        </button>
        {cursor && (
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => void load(true)}
          >
            {t('inbox.replies.loadOlder')}
          </button>
        )}
      </div>
      {loaded && records.length === 0 && <p>{t('inbox.replies.empty')}</p>}
      {canDraft && llmActorRef && (
        <section className="card stack" aria-label={t('inbox.replies.draftTitle')}>
          <h3>{t('inbox.replies.draftTitle')}</h3>
          <p className="subtle">
            {t('inbox.replies.draftDescription')}
          </p>
          <label className="stack">
            {t('inbox.replies.draftInstruction')}
            <textarea
              value={draftPrompt}
              maxLength={4000}
              rows={4}
              disabled={busy || !!draftIntent.current}
              onChange={(event) => setDraftPrompt(event.target.value)}
            />
          </label>
          <p className="subtle">
            {t('inbox.replies.actorAndCount', { actor: llmActorRef, count: draftPrompt.length })}
          </p>
          <div className="action-row">
            <button
              className="btn secondary"
              type="button"
              disabled={busy || !loaded || (!draftIntent.current && !draftPrompt.trim())}
              onClick={() => void generateDraft()}
            >
              {draftIntent.current ? t('inbox.replies.retryDraft') : t('inbox.replies.generateDraft')}
            </button>
          </div>
        </section>
      )}
      {records.map((reply) => (
        <article key={reply.id} className="card stack">
          <h4>
            {attempted.current.has(reply.id)
              ? t('inbox.replies.actionAttempted')
              : reply.draftSource === 'llm'
                ? t('inbox.replies.llmDraft', { state: t(stateKeys[reply.state]) })
                : t(stateKeys[reply.state])}
          </h4>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{reply.body}</p>
          {reply.draftSource === 'llm' && (
            <p className="subtle">
              {t('inbox.replies.proposedBy', { actor: reply.draftActorRef ?? '' })}{' '}
              {reply.approvedByUserId
                ? t('inbox.replies.humanApprovalRecorded', { actor: reply.approvedByUserId })
                : t('inbox.replies.humanApprovalRequired')}
            </p>
          )}
          <p className="subtle">
            {t('inbox.replies.preparedBy', { time: replyTime(reply.createdAt), actor: reply.actorUserId })}
          </p>
          {reply.remoteMessageUuid && (
            <p className="subtle">{t('inbox.replies.providerReceipt', { id: reply.remoteMessageUuid })}</p>
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
                    <p>{t('inbox.replies.approvePrompt')}</p>
                    <div className="action-row">
                      <button
                        type="button"
                        className="btn"
                        disabled={busy || !loaded}
                        onClick={() => void approveDraft(reply)}
                      >
                        {t('inbox.replies.confirmApproval')}
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busy}
                        onClick={() => setApproveId(null)}
                      >
                        {t('inbox.replies.keepPending')}
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
                    {t('inbox.replies.reviewApprove')}
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
                  <p>{t('inbox.replies.actionAttempted')}</p>
                ) : confirmId === reply.id ? (
                  <>
                    <p>{t('inbox.replies.sendPrompt')}</p>
                    <div className="action-row">
                      <button
                        type="button"
                        className="btn"
                        disabled={busy || !loaded}
                        onClick={() => void sendReply(reply)}
                      >
                        {t('inbox.replies.confirmSend')}
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busy}
                        onClick={() => setConfirmId(null)}
                      >
                        {t('inbox.replies.keepPrepared')}
                      </button>
                    </div>
                  </>
                ) : cancelId === reply.id ? (
                  <>
                    <p>{t('inbox.replies.cancelPrompt')}</p>
                    <div className="action-row">
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busy || !loaded}
                        onClick={() => void cancelPrepared(reply)}
                      >
                        {t('inbox.replies.confirmCancellation')}
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busy}
                        onClick={() => setCancelId(null)}
                      >
                        {t('inbox.replies.keepPrepared')}
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
                      {t('inbox.replies.sendPrepared')}
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
                      {t('inbox.replies.cancelPrepared')}
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
            {t('inbox.replies.replyText')}
            <textarea
              value={body}
              maxLength={5000}
              rows={5}
              disabled={!loaded || busy || !!intent.current}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <p className="subtle">{t('inbox.replies.characterCount', { count: body.length })}</p>
          <div className="action-row">
            <button
              className="btn"
              type="button"
              disabled={!loaded || busy || (!intent.current && !body.trim())}
              onClick={() => void prepare()}
            >
              {intent.current ? t('inbox.replies.retrySave') : t('inbox.replies.saveWithoutSending')}
            </button>
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
