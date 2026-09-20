'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';
export default function DisconnectSocialAccountButton({ accountId, displayName }: { accountId: string; displayName: string }) {
  const { t } = useLocale();
  const router = useRouter(); const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const active = useRef(false), key = useRef<string | null>(null);
  async function disconnect() {
    if (active.current) return; if (!window.confirm(t('connection.disconnectConfirmNamed', { name: displayName }))) return;
    active.current = true; setBusy(true); setMessage(''); key.current ??= createIdempotencyKey();
    try {
      const response = await mutationFetch(`/api/v1/social-accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' }, { idempotencyKey: key.current });
      if (!response.ok) { await readDashboardError(response); if ([400, 401, 403, 404, 409, 422].includes(response.status)) { key.current = null; setMessage(t('connection.disconnectRequestRejected')); } else setMessage(t('connection.disconnectRetry')); return; }
      const body = await readDashboardJson<{ data?: { id?: string } }>(response);
      if (body.data?.id !== accountId) throw new Error('Unconfirmed disconnect');
      key.current = null; setMessage(t('connection.disconnectSuccess')); router.refresh();
    } catch { setMessage(t('connection.disconnectRetry')); }
    finally { active.current = false; setBusy(false); }
  }
  return <div className="stack"><button type="button" disabled={busy} onClick={() => void disconnect()}>{busy ? t('connection.disconnecting') : t('action.disconnect')}</button>{message && <p role="status">{message}</p>}</div>;
}
