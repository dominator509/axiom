'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const PLATFORMS = ['instagram', 'tiktok', 'x', 'youtube', 'reddit', 'threads', 'discord', 'telegram', 'facebook', 'snapchat', 'fanvue'];

export default function ApproveButtons({
  bundleId,
  tosBlocked,
}: {
  bundleId: string;
  tosBlocked: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(['instagram']);
  const [slot, setSlot] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(p: string) {
    setSelected((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function act(action: 'approve' | 'revise' | 'reject') {
    setBusy(true);
    setError(null);
    try {
      let res: Response;
      if (action === 'approve') {
        res = await fetch(`/api/v1/bundles/${bundleId}/approve`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ platforms: selected, slot: slot || undefined }),
        });
      } else if (action === 'revise') {
        res = await fetch(`/api/v1/bundles/${bundleId}/revise`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ instructions: 'Revise per operator' }),
        });
      } else {
        res = await fetch(`/api/v1/bundles/${bundleId}/reject`, { method: 'POST' });
      }
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
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {PLATFORMS.map((p) => (
          <button
            key={p}
            type="button"
            className={`btn ${selected.includes(p) ? '' : 'secondary'}`}
            style={{ padding: '4px 10px', fontSize: 12 }}
            onClick={() => toggle(p)}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="row">
        <label style={{ margin: 0 }}>
          Slot
          <input type="datetime-local" value={slot} onChange={(e) => setSlot(e.target.value)} style={{ marginLeft: 8, width: 'auto' }} />
        </label>
      </div>
      {error && <p style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
      <div className="row">
        <button className="btn" type="button" disabled={busy || tosBlocked} onClick={() => act('approve')}>
          {tosBlocked ? 'Blocked by ToS' : 'Approve'}
        </button>
        <button className="btn secondary" type="button" disabled={busy} onClick={() => act('revise')}>
          Revise
        </button>
        <button className="btn danger" type="button" disabled={busy} onClick={() => act('reject')}>
          Reject
        </button>
      </div>
    </div>
  );
}
