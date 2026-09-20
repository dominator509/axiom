'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { RelayCardHistory as RelayCard } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

type ReconciliationOutcome = 'delivered' | 'not_delivered';

function RelayCardReconciliation({ modelId, card, canReconcile }: { modelId: string; card: RelayCard; canReconcile: boolean }) {
  const { t } = useLocale();
  const [state, setState] = useState(card.state);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const intent = useRef<{ outcome: ReconciliationOutcome; key: string } | null>(null);

  if (!canReconcile || !['pending', 'unknown'].includes(state)) return null;

  async function run(next?: ReconciliationOutcome) {
    if (busy) return;
    if (next) intent.current ??= { outcome: next, key: createIdempotencyKey() };
    const request = intent.current;
    if (!request) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await mutationFetch(
        `/api/v1/models/${encodeURIComponent(modelId)}/relay-cards/${encodeURIComponent(card.id)}/reconcile`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outcome: request.outcome }) },
        { idempotencyKey: request.key, retries: 0 },
      );
      if (!response.ok) {
        const details = await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) intent.current = null;
        setError(details.error?.message ?? t('relay.card.reconcileFailed'));
        return;
      }
      const result = await readDashboardJson<{ data?: { state?: unknown } }>(response);
      if (!result.data || typeof result.data.state !== 'string') throw new Error('Unconfirmed relay reconciliation response');
      setState(result.data.state);
      intent.current = null;
      setMessage(t('relay.card.reconcileSaved', { state: result.data.state }));
    } catch {
      setError(t('relay.card.reconcileFailed'));
    } finally {
      setBusy(false);
    }
  }

  return <div className="stack" aria-label={t('relay.card.reconcileHeading')}>
    <strong>{t('relay.card.reconcileHeading')}</strong>
    <p className="subtle" style={{ margin: 0 }}>{t('relay.card.reconcilePending')}</p>
    <div className="action-row">
      <button className="btn secondary" type="button" disabled={busy || !!intent.current} onClick={() => void run('delivered')}>
        {t('relay.card.reconcileDelivered')}
      </button>
      <button className="btn secondary" type="button" disabled={busy || !!intent.current} onClick={() => void run('not_delivered')}>
        {t('relay.card.reconcileNotDelivered')}
      </button>
    </div>
    {intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => void run()}>
      {t(intent.current.outcome === 'delivered' ? 'relay.card.reconcileDelivered' : 'relay.card.reconcileNotDelivered')}
    </button>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}

export default function RelayCardHistory({
  modelId,
  cards,
  nextCursor,
  canReconcile = false,
}: {
  modelId: string;
  cards: RelayCard[];
  nextCursor: string | null;
  canReconcile?: boolean;
}) {
  const { t } = useLocale();
  const displayCreatedAt = (value: string): string => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf())
      ? t('relay.card.dateUnavailable')
      : `${parsed.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  };

  if (cards.length === 0) {
    return <p className="subtle">{t('relay.card.empty')}</p>;
  }

  return <div className="stack" aria-label={t('relay.history.heading')}>
    <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {cards.map(card => <li key={card.id} className="card" style={{ gap: 8 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <strong>{card.icon ? `${card.icon} ` : ''}{card.title || t('relay.card.untitled')}</strong>
          <span className="badge">{card.state}</span>
        </div>
        <div className="subtle">
          {card.channel ?? t('relay.card.channelUnassigned')} · {displayCreatedAt(card.createdAt)}
        </div>
        {card.description && <p style={{ margin: 0 }}>{card.description}</p>}
        <RelayCardReconciliation modelId={modelId} card={card} canReconcile={canReconcile} />
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span className="subtle">{card.enabled ? t('relay.card.enabled') : t('relay.card.disabled')} · {t('relay.card.priority', { value: card.priority })}</span>
          {card.bundleId && <Link href={`/models/${encodeURIComponent(modelId)}/approvals`}>
            {t('relay.card.openApproval')}
          </Link>}
        </div>
      </li>)}
    </ul>
    {nextCursor && <Link className="btn secondary" href={`/models/${encodeURIComponent(modelId)}/relay?cards_cursor=${encodeURIComponent(nextCursor)}`}>
      {t('relay.card.older')}
    </Link>}
  </div>;
}
