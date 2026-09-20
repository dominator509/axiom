'use client';

import { useEffect, useState } from 'react';
import type { FanContact, FanvueAnalyticsSnapshot } from '@/lib/api';
import { useLocale } from './LocaleProvider';

type Props = { modelId: string; canSync: boolean };

export default function FanvueAnalyticsCard({ modelId, canSync }: Props) {
  const { locale, t } = useLocale();
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
    void load().catch(() => setMessage(t('fans.analytics.loadUnavailable')));
  }, [modelId]);

  async function sync() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/v1/models/${encodeURIComponent(modelId)}/fanvue/analytics/sync`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('sync unavailable');
      setMessage(t('fans.analytics.syncQueued'));
    } catch {
      setMessage(t('fans.analytics.syncFailed'));
    } finally {
      setBusy(false);
    }
  }

  const number = new Intl.NumberFormat(locale);
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });
  return <section className="card stack" aria-label={t('fans.analytics.title')}>
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
      <div><h3 style={{ marginBottom: 4 }}>{t('fans.analytics.title')}</h3><p className="subtle">{t('fans.analytics.description')}</p></div>
      {canSync && <button type="button" className="btn secondary" disabled={busy} onClick={() => void sync()}>{busy ? t('fans.analytics.queueing') : t('fans.analytics.sync')}</button>}
    </div>
    {message && <p role="status">{message}</p>}
    {!metric ? <p className="subtle">{t('fans.analytics.noSnapshot')}</p> : <div className="grid">
      <div><strong>{t('fans.analytics.subscribers')}</strong><div>{number.format(metric.subscribers)}</div></div>
      <div><strong>{t('fans.analytics.netEarnings')}</strong><div>{money.format(Number(metric.earningsUsd))}</div></div>
      <div><strong>{t('fans.analytics.unreadMessages')}</strong><div>{number.format(metric.unreadMessages)}</div></div>
      <div><strong>{t('fans.analytics.topSpenders')}</strong><div>{number.format(metric.topSpenderCount)}</div></div>
    </div>}
    {contacts.length > 0 && <details><summary>{t('fans.analytics.contactsSummary')}</summary><ul>
      {contacts.slice(0, 10).map(contact => <li key={contact.id}>{contact.displayName ?? t('fans.analytics.contactFallback')} — {contact.tier} — {t('fans.analytics.lifetimeValue', { value: money.format(Number(contact.lifetimeValueUsd)) })}</li>)}
    </ul></details>}
  </section>;
}
