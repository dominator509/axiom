'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

export default function SnapchatConnect({ modelId }: { modelId: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');
  const key = useRef<string | null>(null);

  async function connectManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || complete) return;
    setBusy(true);
    setError('');
    key.current ??= createIdempotencyKey();
    try {
      const response = await mutationFetch('/api/v1/connectors/snapchat/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelId, username: username.trim() }),
      }, { idempotencyKey: key.current, retries: 0 });
      if (!response.ok) {
        await readDashboardError(response);
        setError(t('network.snapchatManualFailed'));
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) key.current = null;
        return;
      }
      const result = await readDashboardJson<{ status?: string; platform?: string; mode?: string }>(response);
      if (result.status !== 'success' || result.platform !== 'snapchat' || result.mode !== 'manual-assist') throw new Error('Unconfirmed Snapchat connection');
      setComplete(true);
      key.current = null;
      router.refresh();
    } catch {
      setError(t('network.snapchatManualFailed'));
    } finally {
      setBusy(false);
    }
  }

  return <div className="stack">
    <p className="subtle">{t('network.snapchatAllowlistNote')}</p>
    <a className="btn secondary" href={`/api/v1/connectors/snapchat/authorize?modelId=${encodeURIComponent(modelId)}`}>
      {t('network.connectSnapchatApi')}
    </a>
    <form className="stack" onSubmit={event => void connectManual(event)}>
      <label>
        {t('network.snapchatUsername')}
        <input autoComplete="off" maxLength={64} pattern="[A-Za-z0-9._-]+" required value={username} onChange={event => setUsername(event.target.value)} />
      </label>
      <button className="btn secondary" type="submit" disabled={busy || complete || !username.trim()}>
        {busy ? t('network.snapchatConnecting') : t('network.connectSnapchatManual')}
      </button>
      {error && <p role="alert">{error}</p>}
      {complete && <p role="status">{t('network.snapchatManualSuccess')}</p>}
    </form>
  </div>;
}
