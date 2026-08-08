import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function ModelOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let model;
  let network;
  let calendarCount = 0;
  let fanCount = 0;
  try {
    model = (await api.models.get(id)).data;
  } catch {
    model = null;
  }
  try {
    network = (await api.models.network(id)).data;
  } catch {
    network = null;
  }
  try {
    calendarCount = (await api.models.calendar(id)).data.length;
  } catch {
    calendarCount = 0;
  }
  try {
    fanCount = (await api.models.fans(id)).data.length;
  } catch {
    fanCount = 0;
  }

  if (!model) return <div className="card">Model not found.</div>;

  return (
    <div className="grid">
      <div className="card stack">
        <h3>Profile</h3>
        <div>
          <strong>Handle:</strong> @{model.handle}
        </div>
        <div>
          <strong>Bio:</strong> {model.bio ?? '—'}
        </div>
        <div>
          <strong>Created:</strong> {new Date(model.createdAt).toLocaleDateString()}
        </div>
      </div>
      <div className="card stack">
        <h3>Network &amp; security</h3>
        {network ? (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>Egress</span>
              <span className="mono">{network.egressMode}</span>
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
                <span>Egress IP</span>
                <span className="mono">{network.lastEgressIp}</span>
              </div>
            )}
            {network.lastError && <div style={{ color: 'var(--bad)' }}>{network.lastError}</div>}
          </>
        ) : (
          <p style={{ color: 'var(--muted)', margin: 0 }}>No egress config.</p>
        )}
      </div>
      <div className="card stack">
        <h3>Activity</h3>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>Scheduled posts</span>
          <strong>{calendarCount}</strong>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>Fan contacts</span>
          <strong>{fanCount}</strong>
        </div>
      </div>
    </div>
  );
}
