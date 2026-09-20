'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

export default function RevokeConsentButton({
  modelId,
  recordId,
}: {
  modelId: string;
  recordId: string;
}) {
  const router = useRouter();
  const { t } = useLocale();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const active = useRef(false),
    key = useRef<string | null>(null);
  async function revoke() {
    if (!window.confirm(t('consent.revokeConfirm'))) return;
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setMessage('');
    key.current ??= createIdempotencyKey();
    try {
      const response = await mutationFetch(
        `/api/v1/models/${encodeURIComponent(modelId)}/consent-records/${encodeURIComponent(recordId)}/revoke`,
        { method: 'POST' },
        { idempotencyKey: key.current },
      );
      if (!response.ok) {
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) key.current = null;
        setMessage(t('consent.revokeHttp', { status: response.status }));
        return;
      }
      const body = await readDashboardJson<{ data?: { id?: string; granted?: boolean } }>(response);
      if (body.data?.id !== recordId || body.data.granted !== false)
        throw new Error('Unconfirmed revocation');
      key.current = null;
      setMessage(t('consent.revokedMessage'));
      router.refresh();
    } catch {
      setMessage(t('consent.revokeUnconfirmed'));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <button type="button" disabled={busy} onClick={() => void revoke()}>
        {busy ? t('consent.revoking') : t('consent.revoke')}
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
