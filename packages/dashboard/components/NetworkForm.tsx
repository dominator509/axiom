'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const MODES = ['direct', 'socks5', 'http', 'https', 'wireguard', 'vpn'] as const;

interface NetworkConfig {
  egressMode?: string;
  proxyAddr?: string | null;
  expectedEgressIp?: string | null;
}

export default function NetworkForm({
  modelId,
  initial,
}: {
  modelId: string;
  initial: NetworkConfig | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<string>(initial?.egressMode ?? 'direct');
  const [proxyAddr, setProxyAddr] = useState(initial?.proxyAddr ?? '');
  const [expectedIp, setExpectedIp] = useState(initial?.expectedEgressIp ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const body: Record<string, unknown> = { egressMode: mode };
      if (proxyAddr) body.proxyAddr = proxyAddr;
      if (expectedIp) body.expectedEgressIp = expectedIp;
      const res = await fetch(`/api/v1/models/${modelId}/network`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b?.error?.message ?? 'Save failed');
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="stack" style={{ maxWidth: 480 }}>
      <div>
        <label htmlFor="mode">Egress mode</label>
        <select id="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="proxyAddr">Proxy address (host:port)</label>
        <input id="proxyAddr" value={proxyAddr} onChange={(e) => setProxyAddr(e.target.value)} placeholder="127.0.0.1:1080" />
      </div>
      <div>
        <label htmlFor="expectedIp">Expected egress IP (drift policy)</label>
        <input id="expectedIp" value={expectedIp} onChange={(e) => setExpectedIp(e.target.value)} placeholder="203.0.113.7" />
      </div>
      {error && <p style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
      {done && <p style={{ color: 'var(--good)', margin: 0 }}>Saved.</p>}
      <div className="row">
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save network config'}
        </button>
      </div>
    </form>
  );
}
