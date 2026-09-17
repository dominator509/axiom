'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';

export default function VariantReviewCreate({ modelId, variantId, assignmentId }: { modelId: string; variantId: string; assignmentId?: string }) {
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [message, setMessage] = useState('');
  const active = useRef(false), key = useRef<string | null>(null);
  async function create() {
    if (active.current || saved) return;
    active.current = true; setBusy(true); setMessage(''); key.current ??= createIdempotencyKey();
    try {
      const response = await mutationFetch('/api/v1/bundles', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelId, variantId, assignmentId }),
      }, { idempotencyKey: key.current, retries: 0 });
      if (!response.ok) {
        const error = await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) key.current = null;
        setMessage(error?.error?.message ?? 'Review creation was not confirmed.'); return;
      }
      const result = await readDashboardJson<{ data?: { id?: string } }>(response);
      if (!result.data?.id || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(result.data.id)) throw new Error('Unconfirmed review');
      setSaved(true); key.current = null;
      setMessage('Saved copy and media sent for a fresh review. Nothing was published. Revising the copy removes its variant attribution.');
    } catch { setMessage('Outcome uncertain. Retry the same request to avoid duplicate reviews.'); }
    finally { active.current = false; setBusy(false); }
  }
  return <div className="stack">
    {!saved && <button type="button" className="btn secondary" disabled={busy} onClick={() => void create()}>{busy ? 'Creating review…' : key.current ? 'Retry same variant review' : 'Send saved variant for review'}</button>}
    {message && <p role="status">{message}</p>}
    {saved && <Link href={`/models/${encodeURIComponent(modelId)}/approvals`}>Open approvals</Link>}
  </div>;
}
