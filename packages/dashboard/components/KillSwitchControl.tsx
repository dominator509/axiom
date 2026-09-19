'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutationFetch } from '@/lib/mutation';
import { readDashboardError } from '@/lib/response';
import { useLocale } from './LocaleProvider';

export default function KillSwitchControl({ enabled }: { enabled: boolean }) {
  const { t } = useLocale();
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function flip(enable: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await mutationFetch(
        enable ? '/api/v1/killswitch/enable' : '/api/v1/killswitch/disable',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          ...(enable ? { body: JSON.stringify({ reason: reason || undefined }) } : {}),
        },
      );
      if (!res.ok) {
        const b = await readDashboardError(res);
        setError(b?.error?.message ?? t('safety.actionFailed'));
        return;
      }
      router.refresh();
    } catch {
      setError(t('safety.networkError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {!enabled && (
        <div>
          <label htmlFor="ks-reason">{t('safety.reasonLabel')}</label>
          <input
            id="ks-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('safety.reasonPlaceholder')}
          />
        </div>
      )}
      {error && <p style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
      {enabled ? (
        <button className="btn" type="button" disabled={busy} onClick={() => flip(false)}>
          {busy ? t('safety.restoring') : t('safety.restore')}
        </button>
      ) : (
        <button className="btn danger" type="button" disabled={busy} onClick={() => flip(true)}>
          {busy ? t('safety.engaging') : t('safety.engage')}
        </button>
      )}
    </div>
  );
}
