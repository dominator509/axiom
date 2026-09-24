'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError } from '@/lib/response';
import { useLocale } from './LocaleProvider';

type Link = { id: string; slug: string; revenueCents: number; costCents: number; roiPercent: number | null; currency?: string | null; revenueByCurrency?: Record<string, number>; costByCurrency?: Record<string, number>; roiByCurrency?: Record<string, number | null> };

export default function LinkbioCostManager({ modelId, links, canEdit }: { modelId: string; links: Link[]; canEdit: boolean }) {
  const { locale = 'en', t } = useLocale();
  const router = useRouter();
  const [shortLinkId, setShortLinkId] = useState(links[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const intent = useRef<{ key: string; body: string } | null>(null);

  async function recordSpend() {
    if (busy || !canEdit || !shortLinkId) return;
    const amountCents = Number(amount);
    if (!Number.isSafeInteger(amountCents) || amountCents < 0 || !/^[A-Z]{3}$/.test(currency)) {
      setMessage(t('modelSurface.spendSaveFailed'));
      return;
    }
    intent.current ??= {
      key: createIdempotencyKey(),
      body: JSON.stringify({
        eventKey: createIdempotencyKey(), shortLinkId, amountCents, currency,
        occurredAt: new Date().toISOString(),
      }),
    };
    setBusy(true);
    setMessage('');
    try {
      const response = await mutationFetch(`/api/v1/models/${encodeURIComponent(modelId)}/linkbio/campaign-costs`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: intent.current.body,
      }, { idempotencyKey: intent.current.key, retries: 0 });
      if (!response.ok) {
        const errorBody = await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) intent.current = null;
        setMessage(errorBody?.error?.message ?? t('modelSurface.spendSaveFailed'));
        return;
      }
      intent.current = null;
      setAmount('');
      setMessage(t('modelSurface.spendRecorded'));
      router.refresh();
    } catch {
      setMessage(t('modelSurface.spendSaveFailed'));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void recordSpend();
  }

  function currencyTotals(values: Record<string, number> | undefined, fallback: number, currency?: string | null): string {
    const entries = Object.entries(values ?? {}).filter(([code, cents]) => /^[A-Z]{3}$/.test(code) && Number.isSafeInteger(cents));
    const selected = entries.length ? entries : (currency ? [[currency, fallback] as [string, number]] : []);
    if (!selected.length) return '—';
    return selected.sort(([left], [right]) => left.localeCompare(right)).map(([code, cents]) => {
      try { return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(cents / 100); }
      catch { return `${(cents / 100).toFixed(2)} ${code}`; }
    }).join(' · ');
  }
  function roiTotals(link: Link): string {
    const entries = Object.entries(link.roiByCurrency ?? {}).filter(([code, value]) => /^[A-Z]{3}$/.test(code) && typeof value === 'number' && Number.isFinite(value));
    if (!entries.length) return link.roiPercent == null ? '—' : `${link.roiPercent.toLocaleString(locale)}%`;
    return entries.sort(([left], [right]) => left.localeCompare(right)).map(([code, value]) => `${code} ${Number(value).toLocaleString(locale)}%`).join(' · ');
  }

  return <div className="stack">
    <h4>{t('modelSurface.campaignCosts')}</h4>
    {links.length > 0 ? <table>
      <thead><tr><th>{t('modelSurface.shortLink')}</th><th>{t('modelSurface.spend')}</th><th>{t('modelSurface.roi')}</th></tr></thead>
      <tbody>{links.map(link => <tr key={link.id}>
        <td>{link.slug}</td>
        <td>{currencyTotals(link.costByCurrency, link.costCents, link.currency)}</td>
        <td>{roiTotals(link)}</td>
      </tr>)}</tbody>
    </table> : <p className="subtle">{t('modelSurface.selectShortLink')}</p>}
    {canEdit && links.length > 0 && <form className="row" onSubmit={submit}>
      <label>{t('modelSurface.selectShortLink')}
        <select value={shortLinkId} onChange={event => setShortLinkId(event.target.value)} disabled={busy || intent.current !== null}>
          {links.map(link => <option key={link.id} value={link.id}>{link.slug}</option>)}
        </select>
      </label>
      <label>{t('modelSurface.costAmount')}
        <input aria-label={t('modelSurface.costAmount')} type="number" min="0" step="1" value={amount} onChange={event => setAmount(event.target.value)} disabled={busy || intent.current !== null} required />
      </label>
      <label>{t('modelSurface.costCurrency')}
        <input aria-label={t('modelSurface.costCurrency')} value={currency} maxLength={3} pattern="[A-Z]{3}" onChange={event => setCurrency(event.target.value.toUpperCase())} disabled={busy || intent.current !== null} required />
      </label>
      <button className="btn" type="submit" disabled={busy || !amount}>{busy ? '…' : t('modelSurface.recordSpend')}</button>
      {intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => void recordSpend()}>{t('linkbio.retry')}</button>}
    </form>}
    {message && <p role="status">{message}</p>}
    {!canEdit && <p className="subtle">{t('linkbio.roleRequiredEdit')}</p>}
  </div>;
}
