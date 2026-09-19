'use client';
import Link from 'next/link';
import type { RelayCardHistory as RelayCard } from '@/lib/api';
import { useLocale } from './LocaleProvider';

export default function RelayCardHistory({
  modelId,
  cards,
  nextCursor,
}: {
  modelId: string;
  cards: RelayCard[];
  nextCursor: string | null;
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
