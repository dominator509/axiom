'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
export default function DisconnectSocialAccountButton({ accountId, displayName }: { accountId: string; displayName: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const active = useRef(false), key = useRef<string | null>(null);
  async function disconnect() {
    if (active.current) return; if (!window.confirm(`Disconnect ${displayName}? Provider revocation must succeed before the local account is removed.`)) return;
    active.current = true; setBusy(true); setMessage(''); key.current ??= createIdempotencyKey();
    try {
      const response = await mutationFetch(`/api/v1/social-accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' }, { idempotencyKey: key.current });
      if (!response.ok) { const details = await readDashboardError(response); if ([400, 401, 403, 404, 409, 422].includes(response.status)) key.current = null; setMessage(details?.error?.message ?? `Disconnect not confirmed (HTTP ${response.status}).`); return; }
      const body = await readDashboardJson<{ data?: { id?: string } }>(response);
      if (body.data?.id !== accountId) throw new Error('Unconfirmed disconnect');
      key.current = null; setMessage('Provider revoked and local connection removed.'); router.refresh();
    } catch { setMessage('Disconnect not confirmed. Retry to check the same revocation request.'); }
    finally { active.current = false; setBusy(false); }
  }
  return <div className="stack"><button type="button" disabled={busy} onClick={() => void disconnect()}>{busy ? 'Disconnecting…' : 'Disconnect'}</button>{message && <p role="status">{message}</p>}</div>;
}
