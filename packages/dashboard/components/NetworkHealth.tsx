'use client';
import { useRef, useState } from 'react';
import { fetchWithTimeout } from '@/lib/request';
import { readBoundedResponseJson } from '@axiom/core';

export function describeNetworkHealth(body: unknown, modelId: string): string {
  const data = (body as { data?: { modelId?: unknown; live?: { model_id?: unknown; mode?: unknown; healthy?: unknown; egress_ip?: unknown } | null } } | null)?.data;
  if (!data || data.modelId !== modelId) throw new Error('Unexpected network status response');
  const live = data.live;
  if (!live) return 'No live connection confirmed. The connection may be unbound or the network service unavailable.';
  if (live.model_id !== modelId) throw new Error('Unexpected connection identity');
  if (live.mode === 'direct') return 'Direct mode: traffic is not protected by a VPN or proxy.';
  if (live.healthy !== true) return 'The network service reports this connection as unhealthy. Protected connectivity is not confirmed.';
  if (typeof live.egress_ip !== 'string' || !live.egress_ip) return 'Connection reports healthy, but no outbound IP was returned. IP verification is incomplete.';
  return `The network service reports a healthy connection. Observed outbound IP: ${live.egress_ip}.`;
}

export default function NetworkHealth({ modelId }: { modelId: string }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('Live connection status has not been checked.');
  const active = useRef(false);
  async function check() {
    if (active.current) return;
    active.current = true; setBusy(true); setMessage('Checking network service status…');
    try {
      const response = await fetchWithTimeout(`/api/v1/models/${encodeURIComponent(modelId)}/network/health`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Status unavailable');
      setMessage(describeNetworkHealth(await readBoundedResponseJson(response), modelId));
    } catch { setMessage('Live status could not be checked. Do not assume the connection is protected. Try again.'); }
    finally { active.current = false; setBusy(false); }
  }
  return <section className="card stack" aria-label="Live connection status">
    <h3>Live connection status</h3>
    <p role="status">{message}</p>
    <p className="subtle">Reads the network service’s latest health result. It does not activate a tunnel or perform a new leak test.</p>
    <button type="button" disabled={busy} onClick={() => void check()}>{busy ? 'Checking…' : 'Check live connection status'}</button>
  </section>;
}
