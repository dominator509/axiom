'use client';

import { useEffect, useState } from 'react';
import type { FanContact, FanvueAnalyticsSnapshot } from '@/lib/api';

type Props = { modelId: string; canSync: boolean };

export default function FanvueAnalyticsCard({ modelId, canSync }: Props) {
  const [metric, setMetric] = useState<FanvueAnalyticsSnapshot | null>(null);
  const [contacts, setContacts] = useState<FanContact[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch(`/api/v1/models/${encodeURIComponent(modelId)}/fanvue/analytics`, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error('Fanvue analytics unavailable');
    const body = await response.json() as { data: { metric: FanvueAnalyticsSnapshot | null; contacts: FanContact[] } };
    setMetric(body.data.metric);
    setContacts(body.data.contacts);
  }

  useEffect(() => {
    void load().catch(() => setMessage('Fanvue account analytics are not available yet.'));
  }, [modelId]);

  async function sync() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/v1/models/${encodeURIComponent(modelId)}/fanvue/analytics/sync`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('sync unavailable');
      setMessage('Fanvue analytics sync queued. Refresh this card after the worker completes.');
    } catch {
      setMessage('Fanvue analytics could not be queued. Check the account connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const number = new Intl.NumberFormat();
  const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
  return <section className="card stack" aria-label="Fanvue account analytics">
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
      <div><h3 style={{ marginBottom: 4 }}>Fanvue account analytics</h3><p className="subtle">Account-level subscribers, earnings, unread messages and top-spender CRM facts.</p></div>
      {canSync && <button type="button" className="btn secondary" disabled={busy} onClick={() => void sync()}>{busy ? 'Queueing…' : 'Sync Fanvue analytics'}</button>}
    </div>
    {message && <p role="status">{message}</p>}
    {!metric ? <p className="subtle">No account snapshot has been synchronized yet.</p> : <div className="grid">
      <div><strong>Subscribers</strong><div>{number.format(metric.subscribers)}</div></div>
      <div><strong>Net earnings</strong><div>{money.format(Number(metric.earningsUsd))}</div></div>
      <div><strong>Unread messages</strong><div>{number.format(metric.unreadMessages)}</div></div>
      <div><strong>Top spenders</strong><div>{number.format(metric.topSpenderCount)}</div></div>
    </div>}
    {contacts.length > 0 && <details><summary>Synced Fanvue CRM contacts</summary><ul>
      {contacts.slice(0, 10).map(contact => <li key={contact.id}>{contact.displayName ?? 'Fan'} — {contact.tier} — {money.format(Number(contact.lifetimeValueUsd))}</li>)}
    </ul></details>}
  </section>;
}

