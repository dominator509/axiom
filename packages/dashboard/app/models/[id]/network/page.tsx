import { api } from '@/lib/api';
import NetworkForm from '@/components/NetworkForm';

export const dynamic = 'force-dynamic';

export default async function NetworkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let network;
  try {
    network = (await api.models.network(id)).data;
  } catch {
    network = null;
  }

  return (
    <div>
      <div className="card">
        <h2>Network &amp; Security (F-02 / F-04)</h2>
        {network && (
          <div className="stack" style={{ marginBottom: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>Egress mode</span>
              <span className="mono">{network.egressMode}</span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>Health</span>
              {network.healthy ? <span className="badge good">healthy</span> : <span className="badge bad">degraded</span>}
            </div>
            {network.latencyMs != null && (
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>Latency</span>
                <span>{network.latencyMs} ms</span>
              </div>
            )}
            {network.lastEgressIp && (
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>Last egress IP</span>
                <span className="mono">{network.lastEgressIp}</span>
              </div>
            )}
            {network.lastError && <div style={{ color: 'var(--bad)' }}>{network.lastError}</div>}
          </div>
        )}
        <NetworkForm modelId={id} initial={network} />
      </div>
      <div className="card">
        <h2>Connected accounts</h2>
        <SocialAccounts modelId={id} />
      </div>
    </div>
  );
}

async function SocialAccounts({ modelId }: { modelId: string }) {
  let accounts: Array<Record<string, unknown>> = [];
  try {
    accounts = (await api.social.list(modelId)).data;
  } catch {
    accounts = [];
  }
  if (accounts.length === 0) {
    return <p style={{ color: 'var(--muted)', margin: 0 }}>No platform accounts connected.</p>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Platform</th>
          <th>Display name</th>
          <th>Status</th>
          <th>Capabilities</th>
        </tr>
      </thead>
      <tbody>
        {accounts.map((a) => (
          <tr key={String(a.id)}>
            <td>{String(a.platform)}</td>
            <td>{String(a.displayName)}</td>
            <td>
              <span className={`badge ${a.status === 'connected' ? 'good' : 'mute'}`}>{String(a.status)}</span>
            </td>
            <td className="mono">{(a.capabilities as string[])?.join(', ') ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
