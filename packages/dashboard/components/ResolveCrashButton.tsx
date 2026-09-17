'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { readBoundedResponseJson } from '@axiom/core';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';

export default function ResolveCrashButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const active = useRef(false), key = useRef<string | null>(null);
  async function resolve() {
    if (active.current) return;
    active.current = true; setBusy(true); setMessage('');
    key.current ??= createIdempotencyKey();
    try {
      const response = await mutationFetch(`/api/v1/crash-reports/${encodeURIComponent(reportId)}/resolve`, { method: 'PATCH' }, { idempotencyKey: key.current });
      if (!response.ok) {
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) key.current = null;
        setMessage(`Resolution not confirmed (HTTP ${response.status}). Refresh the list before retrying.`); return;
      }
      const body = await readBoundedResponseJson(response) as { data?: { id?: unknown; status?: unknown } } | null;
      if (body?.data?.id !== reportId || body.data.status !== 'resolved') throw new Error('Unconfirmed resolution');
      key.current = null; setMessage('Marked resolved. This does not replay jobs or fix the underlying cause.'); router.refresh();
    } catch { setMessage('Resolution not confirmed. Retry to check the same request.'); }
    finally { active.current = false; setBusy(false); }
  }
  return <div className="stack"><button type="button" disabled={busy} onClick={resolve}>{busy ? 'Saving…' : 'Mark resolved'}</button>{message && <p role="status">{message}</p>}</div>;
}
