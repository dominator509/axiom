'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutationFetch } from '@/lib/mutation';

export default function ReplayButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function replay() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await mutationFetch(`/api/v1/incidents/${jobId}/replay`, { method: 'POST' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setMsg(b?.error?.message ?? 'Replay failed');
      } else {
        setMsg('Requeued');
        router.refresh();
      }
    } catch {
      setMsg('Network error');
    } finally {
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
      {msg && <span style={{ color: 'var(--muted)', marginLeft: 6, fontSize: 12 }}>{msg}</span>}
    </span>
  );
}
