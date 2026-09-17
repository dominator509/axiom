'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
export default function RevokeConsentButton({ modelId, recordId }: { modelId: string; recordId: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const active = useRef(false), key = useRef<string | null>(null);
  async function revoke() {
    if (active.current) return; active.current = true; setBusy(true); setMessage(''); key.current ??= createIdempotencyKey();
    try {
      const response = await mutationFetch(`/api/v1/models/${encodeURIComponent(modelId)}/consent-records/${encodeURIComponent(recordId)}/revoke`, { method: 'POST' }, { idempotencyKey: key.current });
      if (!response.ok) { const d = await readDashboardError(response); if ([400, 401, 403, 404, 409, 422].includes(response.status)) key.current = null; setMessage(d?.error?.message ?? `Revocation not confirmed (HTTP ${response.status}).`); return; }
      const body = await readDashboardJson<{ data?: { id?: string; granted?: boolean } }>(response);
      if (body.data?.id !== recordId || body.data.granted !== false) throw new Error('Unconfirmed revocation');
      key.current = null; setMessage('Record revoked. Publication gates will no longer treat it as granted.'); router.refresh();
    } catch { setMessage('Revocation not confirmed. Retry to check the same request.'); }
    finally { active.current = false; setBusy(false); }
  }
  return <div className="stack"><button type="button" disabled={busy} onClick={() => void revoke()}>{busy ? 'Revoking…' : 'Revoke record'}</button>{message && <p role="status">{message}</p>}</div>;
}
