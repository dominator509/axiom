import { api, getSession } from '@/lib/api';
import FanContactForm from '@/components/FanContactForm';
import CustomRequestForm from '@/components/CustomRequestForm';
import FanInteractionForm from '@/components/FanInteractionForm';
import Link from 'next/link';
import type { FanTimeline } from '@/lib/api';
import { talentDestinationAllowed } from '@/lib/navigation-role';

export const dynamic = 'force-dynamic';

const TIER_BADGE: Record<string, string> = {
  whale: 'good',
  loyal: 'good',
  expired: 'warn',
  new: 'mute',
};

export default async function FansPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ fan?: string | string[]; cursor?: string | string[] }> }) {
  const { id } = await params;
  const query = await searchParams;
  const cursor = typeof query?.cursor === 'string' ? query.cursor : undefined;
  const basePath = `/models/${encodeURIComponent(id)}/fans`;
  const currentList = `${basePath}${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`;
  const session = await getSession();
  if (!talentDestinationAllowed(session?.user?.role, 'fans')) return <div className="card stack"><h2>Fan CRM access unavailable</h2><p>Your role does not include these fan records.</p><Link href="/">Back to workspace</Link></div>;
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  let fans: Awaited<ReturnType<typeof api.models.fans>>['data'] = [];
  let requests: Awaited<ReturnType<typeof api.models.customRequests>>['data'] = [];
  const [contactsResult, requestsResult] = await Promise.allSettled([
    api.models.fans(id, cursor), api.models.customRequests(id),
  ]);
  if (contactsResult.status === 'fulfilled') fans = contactsResult.value.data;
  if (requestsResult.status === 'fulfilled') requests = requestsResult.value.data;
  const nextCursor = contactsResult.status === 'fulfilled' ? contactsResult.value.meta?.next_cursor : null;
  const selected = query?.fan;
  let timeline: FanTimeline | null = null;
  let timelineError = false;
  if (selected) {
    try {
      if (typeof selected !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selected)) throw new Error('Invalid fan');
      const result = (await api.fans.get(selected)).data;
      if (result.fan.modelId !== id) throw new Error('Fan belongs to another talent');
      timeline = result;
    } catch { timelineError = true; }
  }

  return (
    <div className="page-stack">
      <h2>Fan relationships</h2>
      <p className="subtle">Browse saved fan contacts and track requests for custom content. Lifetime value is the recorded total spent by a fan.</p>
      {canEdit ? <FanContactForm modelId={id} /> : <p className="subtle">Contact editing requires an owner, manager or operator role.</p>}
      {selected && <section className="card stack" aria-label="Fan timeline">
        <Link href={currentList}>Close fan details</Link>
        {timelineError && <p role="alert">This fan timeline could not be loaded for this talent. Select a contact from the list or try again.</p>}
        {timeline && <>
          <h3>{timeline.fan.displayName ?? 'Fan'} — recorded activity</h3>
          {canEdit && <FanInteractionForm key={timeline.fan.id} fanId={timeline.fan.id} platform={timeline.fan.platform} />}
          <p className="subtle">Up to 100 most recent saved interactions. This is not a live inbox or proof that all platforms have synchronized.</p>
          {timeline.touchpoints.length === 0 ? <p>No recorded interactions yet.</p> : <ol className="stack">
            {timeline.touchpoints.map(point => <li key={point.id}>
              <strong>{point.platform} · {point.kind} · {point.direction}</strong>
              <p><time dateTime={point.ts}>{point.ts}</time></p>
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{point.content ?? 'No text recorded.'}</p>
            </li>)}
          </ol>}
          <h4>Linked custom requests</h4>
          {timeline.requests.length === 0 ? <p>No linked requests.</p> : timeline.requests.map(request => <div className="stack" key={request.id}>
            <strong>{request.title}</strong><span>{request.status}</span>
            {canEdit && <CustomRequestForm requestId={request.id} title={request.title} status={request.status} />}
          </div>)}
        </>}
      </section>}
      <div className="grid">
        <div className="card">
          <h3>High-value contacts</h3>
          {contactsResult.status === 'rejected'
            ? <p role="alert">Fan contacts could not be loaded. Reload this page to try again.</p>
            : fans.length === 0 && <p style={{ color: 'var(--muted)' }}>{cursor ? 'No more contacts on this page.' : 'No fan contacts yet.'}</p>}
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
                  <td><Link href={`${basePath}?${new URLSearchParams({ fan: f.id, ...(cursor ? { cursor } : {}) })}`}>{f.displayName ?? f.id.slice(0, 8)}</Link></td>
                  <td>{f.platform}</td>
                  <td>
                    <span className={`badge ${TIER_BADGE[f.tier] ?? 'mute'}`}>{f.tier}</span>
                  </td>
                  <td>${f.lifetimeValueUsd}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <nav className="row" aria-label="Fan contact pages">
            {cursor && <Link href={basePath}>First contacts</Link>}
            {nextCursor && <Link href={`${basePath}?${new URLSearchParams({ cursor: nextCursor })}`}>Next contacts</Link>}
          </nav>
        </div>
        <div className="card">
          <h3>Custom requests</h3>
          {canEdit && <CustomRequestForm modelId={id} fans={fans} />}
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
                    {canEdit && <CustomRequestForm requestId={r.id} status={r.status} title={r.title} />}
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
