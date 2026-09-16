import { api, getSession } from '@/lib/api';
import type { SocialConnection } from '@/lib/api';
import NetworkForm from '@/components/NetworkForm';
import EgressCredentials from '@/components/EgressCredentials';

export const dynamic = 'force-dynamic';

export default async function NetworkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const owner = session?.user?.role === 'owner';
  let network = null;
  let failed = false;
  if (owner) {
    try {
      network = (await api.models.network(id)).data;
    } catch {
      failed = true;
    }
  }
  const accounts = await SocialAccounts({ modelId: id });

  return (
    <div className="page-stack">
      <div className="card">
        <h2>Network &amp; security</h2>
        {!owner && <p>Only a workspace owner can view or change network configuration. Ask your owner to configure this talent’s outbound connection.</p>}
        {failed && <p role="alert">Network configuration could not be loaded. Reload to try again. Editing is unavailable until the saved configuration can be read.</p>}
        {network && (
          <div className="stack" style={{ marginBottom: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>Egress mode</span>
              <span className="mono">{network.egressMode ?? 'Not configured'}</span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>Health</span>
              {network.healthy ? (
                <span className="badge good">healthy</span>
              ) : (
                <span className="badge bad">degraded</span>
              )}
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
        {owner && network && <NetworkForm modelId={id} initial={network} />}
      </div>
      {owner && network?.id && network.egressMode && network.egressMode !== 'direct' && <EgressCredentials key={`${network.id}:${network.egressMode}`} configId={network.id} mode={network.egressMode} />}
      <div className="card">
        <h2>Connected accounts</h2>
        {accounts}
      </div>
    </div>
  );
}

async function SocialAccounts({ modelId }: { modelId: string }) {
  let accounts: SocialConnection[] = [];
  try {
    accounts = (await api.social.list(modelId)).data;
  } catch {
    return <p role="alert">Connected accounts could not be loaded. Reload to try again; existing connections have not been removed.</p>;
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
              <span className={`badge ${a.status === 'connected' ? 'good' : 'mute'}`}>
                {String(a.status)}
              </span>
            </td>
            <td className="mono">{(a.capabilities as string[])?.join(', ') ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
