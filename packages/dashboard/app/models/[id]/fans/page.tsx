import { api, getSession } from '@/lib/api';
import FanContactForm from '@/components/FanContactForm';

export const dynamic = 'force-dynamic';

const TIER_BADGE: Record<string, string> = {
  whale: 'good',
  loyal: 'good',
  expired: 'warn',
  new: 'mute',
};

export default async function FansPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  let fans: Awaited<ReturnType<typeof api.models.fans>>['data'] = [];
  let requests: Awaited<ReturnType<typeof api.models.customRequests>>['data'] = [];
  const [contactsResult, requestsResult] = await Promise.allSettled([
    api.models.fans(id), api.models.customRequests(id),
  ]);
  if (contactsResult.status === 'fulfilled') fans = contactsResult.value.data;
  if (requestsResult.status === 'fulfilled') requests = requestsResult.value.data;

  return (
    <div className="page-stack">
      <h2>Fan relationships</h2>
      <p className="subtle">Browse saved fan contacts and track requests for custom content. Lifetime value is the recorded total spent by a fan.</p>
      {canEdit ? <FanContactForm modelId={id} /> : <p className="subtle">Contact editing requires an owner, manager or operator role.</p>}
      <div className="grid">
        <div className="card">
          <h3>High-value contacts</h3>
          {contactsResult.status === 'rejected'
            ? <p role="alert">Fan contacts could not be loaded. Reload this page to try again.</p>
            : fans.length === 0 && <p style={{ color: 'var(--muted)' }}>No fan contacts yet.</p>}
          <table>
            <thead>
              <tr>
                <th>Fan</th>
                <th>Platform</th>
                <th>Tier</th>
                <th>Lifetime value</th>
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
          <h3>Custom requests</h3>
          {requestsResult.status === 'rejected' && <p role="alert">Custom requests could not be loaded. Reload this page to try again.</p>}
          {requestsResult.status === 'fulfilled' && requests.length === 0 && (
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
