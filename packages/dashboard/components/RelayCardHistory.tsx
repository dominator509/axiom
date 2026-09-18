import Link from 'next/link';
import type { RelayCardHistory as RelayCard } from '@/lib/api';

function displayCreatedAt(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? 'Date unavailable' : `${parsed.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export default function RelayCardHistory({
  modelId,
  cards,
  nextCursor,
}: {
  modelId: string;
  cards: RelayCard[];
  nextCursor: string | null;
}) {
  if (cards.length === 0) {
    return <p className="subtle">No Relay cards have been recorded for this talent yet.</p>;
  }

  return <div className="stack" aria-label="Relay card history">
    <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {cards.map(card => <li key={card.id} className="card" style={{ gap: 8 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <strong>{card.icon ? `${card.icon} ` : ''}{card.title || 'Untitled Relay card'}</strong>
          <span className="badge">{card.state}</span>
        </div>
        <div className="subtle">
          {card.channel ?? 'channel not assigned'} · {displayCreatedAt(card.createdAt)}
        </div>
        {card.description && <p style={{ margin: 0 }}>{card.description}</p>}
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span className="subtle">{card.enabled ? 'Enabled' : 'Disabled'} · priority {card.priority}</span>
          {card.bundleId && <Link href={`/models/${encodeURIComponent(modelId)}/approvals`}>
            Open approval workflow
          </Link>}
        </div>
      </li>)}
    </ul>
    {nextCursor && <Link className="btn secondary" href={`/models/${encodeURIComponent(modelId)}/relay?cards_cursor=${encodeURIComponent(nextCursor)}`}>
      Older Relay cards
    </Link>}
  </div>;
}
