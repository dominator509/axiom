'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutationFetch } from '@/lib/mutation';

export default function KillSwitchControl({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function flip(enable: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await mutationFetch(
        enable ? '/api/v1/killswitch/enable' : '/api/v1/killswitch/disable',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          ...(enable ? { body: JSON.stringify({ reason: reason || undefined }) } : {}),
        },
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b?.error?.message ?? 'Action failed');
        return;
      }
      router.refresh();
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {!enabled && (
        <div>
          <label htmlFor="ks-reason">Reason (recorded in audit)</label>
          <input
            id="ks-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Emergency — platform flagged account"
          />
        </div>
      )}
      {error && <p style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
      {enabled ? (
        <button className="btn" type="button" disabled={busy} onClick={() => flip(false)}>
          {busy ? 'Restoring…' : 'Restore publishing'}
        </button>
      ) : (
        <button className="btn danger" type="button" disabled={busy} onClick={() => flip(true)}>
          {busy ? 'Engaging…' : 'ENGAGE KILL SWITCH'}
        </button>
      )}
    </div>
  );
}
