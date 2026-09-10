'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError } from '@/lib/response';

export default function ReplayButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const inFlight = useRef(false);
  const intent = useRef<{ jobId: string; key: string } | null>(null);

  async function replay() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMsg(null);
    try {
      if (intent.current?.jobId !== jobId) {
        intent.current = { jobId, key: createIdempotencyKey() };
      }
      const res = await mutationFetch(`/api/v1/incidents/${jobId}/replay`, { method: 'POST' }, {
        idempotencyKey: intent.current.key,
      });
      if (!res.ok) {
        const b = await readDashboardError(res);
        setMsg(b?.error?.message ?? 'Replay failed');
      } else {
        intent.current = null;
        setMsg('Requeued');
        router.refresh();
      }
    } catch {
      setMsg('Replay could not be confirmed. Retry to check the same request.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <span>
      <button
        className="btn secondary"
        type="button"
        disabled={busy}
        onClick={replay}
        style={{ padding: '4px 10px', fontSize: 12 }}
      >
        {busy ? '…' : 'Replay'}
      </button>
      {msg && <span role="status" style={{ color: 'var(--muted)', marginLeft: 6, fontSize: 12 }}>{msg}</span>}
    </span>
  );
}
