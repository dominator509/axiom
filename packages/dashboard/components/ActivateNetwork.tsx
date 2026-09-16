'use client';
import { useRef, useState } from 'react';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';

export default function ActivateNetwork({ modelId }: { modelId: string }) {
  const [approved, setApproved] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const key = useRef<string | null>(null), active = useRef(false);
  async function activate() {
    if (!approved || active.current) return;
    active.current = true; setBusy(true); setMessage('Applying saved connection configuration…');
    key.current ??= createIdempotencyKey();
    try {
      const response = await mutationFetch('/api/v1/egress/plane/sync', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model_id: modelId }),
      }, { idempotencyKey: key.current, timeoutMs: 40000 });
      if (!response.ok) {
        setMessage(`Activation not confirmed (HTTP ${response.status}). Check live status before retrying. A 404 may mean the network service needs updating.`); return;
      }
      key.current = null; setApproved(false);
      setMessage('Configuration reconciliation completed. Check live connection status below: completion does not mean the tunnel is healthy.');
    } catch { setMessage('Activation not confirmed. Check live status before retrying the same request.'); }
    finally { active.current = false; setBusy(false); }
  }
  return <section className="card stack" aria-label="Apply saved network configuration">
    <h3>Apply saved connection</h3>
    <p>This applies only this talent’s saved configuration and may interrupt ongoing work. Direct mode removes its isolated connection. This does not disable the safety switch.</p>
    <label className="checkbox-option"><input type="checkbox" checked={approved} disabled={busy} onChange={event => setApproved(event.target.checked)} /> I approve applying this talent’s saved configuration.</label>
    <button type="button" disabled={!approved || busy} onClick={() => void activate()}>{busy ? 'Applying…' : 'Apply saved connection'}</button>
    <p role="status">{message}</p>
  </section>;
}
