import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

const TIER_BADGE: Record<string, string> = {
  whale: 'good',
  loyal: 'good',
  expired: 'warn',
  new: 'mute',
};

export default async function FansPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let fans: Awaited<ReturnType<typeof api.models.fans>>['data'] = [];
  let requests: Awaited<ReturnType<typeof api.models.customRequests>>['data'] = [];
  try {
    [fans, requests] = await Promise.all([api.models.fans(id), api.models.customRequests(id)]).then(
      ([f, r]) => [f.data, r.data],
    );
  } catch {
    fans = [];
    requests = [];
  }

  return (
    <div>
      <h2>Fan CRM (F-05..F-08)</h2>
      <div className="grid">
        <div className="card">
          <h3>High-value contacts</h3>
          {fans.length === 0 && <p style={{ color: 'var(--muted)' }}>No fan contacts yet.</p>}
          <table>
            <thead>
              <tr>
                <th>Fan</th>
                <th>Platform</th>
                <th>Tier</th>
                <th>LTV</th>
              </tr>
            </thead>
            <tbody>
              {fans.map((f) => (
                <tr key={f.id}>
                  <td>{f.displayName ?? f.id.slice(0, 8)}</td>
                  <td>{f.platform}</td>
                  <td>
                    <span className={`badge ${TIER_BADGE[f.tier] ?? 'mute'}`}>{f.tier}</span>
                  </td>
                  <td>${f.lifetimeValueUsd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Custom requests (F-08)</h3>
          {requests.length === 0 && (
            <p style={{ color: 'var(--muted)' }}>No custom request tickets.</p>
          )}
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{r.title}</td>
                  <td>
                    <span className={`badge ${r.status === 'delivered' ? 'good' : 'warn'}`}>
                      {r.status}
                    </span>
                  </td>
                  <td>{r.priceUsd ? `$${r.priceUsd}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
