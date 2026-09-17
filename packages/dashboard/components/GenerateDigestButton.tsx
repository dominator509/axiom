'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
export default function GenerateDigestButton() {
  const router = useRouter(); const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const active = useRef(false), key = useRef<string | null>(null);
  async function generate() {
    if (active.current) return; active.current = true; setBusy(true); setMessage(''); key.current ??= createIdempotencyKey();
    try {
      const response = await mutationFetch('/api/v1/digests/generate', { method: 'POST' }, { idempotencyKey: key.current, retries: 0 });
      if (!response.ok) { const d = await readDashboardError(response); if ([400, 401, 403, 404, 409, 422].includes(response.status)) key.current = null; setMessage(d?.error?.message ?? `Digest request not confirmed (HTTP ${response.status}).`); return; }
      const body = await readDashboardJson<{ jobId?: string }>(response);
      if (typeof body.jobId !== 'string' || !body.jobId) throw new Error('Unconfirmed digest request');
      key.current = null; setMessage(`Digest queued (${body.jobId.slice(0, 8)}…). It will appear here when the worker creates the relay card.`); router.refresh();
    } catch { setMessage('Digest request not confirmed. Retry to check the same request.'); }
    finally { active.current = false; setBusy(false); }
  }
  return <div className="stack"><button type="button" disabled={busy} onClick={() => void generate()}>{busy ? 'Queueing…' : 'Generate this week’s digest'}</button>{message && <p role="status">{message}</p>}</div>;
}
